import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuthService, type AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, UserStatus } from '../generated/prisma/client.js';

type Actor = Pick<AuthenticatedUser, 'id'>;
type Tx = Prisma.TransactionClient;

export interface AdminUserView {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
  roles: ('ADMIN' | 'USER')[];
  /** Granted by ADMIN_EMAILS on every login: demoting here would not stick. */
  adminFromEnvironment: boolean;
  isSelf: boolean;
  googleConnection: 'ACTIVE' | 'NEEDS_REAUTH' | 'REVOKED' | null;
  spreadsheets: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserQuery {
  q?: string | undefined;
  status?: UserStatus | undefined;
  role?: 'ADMIN' | 'USER' | undefined;
  page: number;
  pageSize: number;
}

const INCLUDE = {
  roles: { include: { role: true } },
  profile: { select: { firstName: true, lastName: true } },
  googleConnection: { select: { status: true } },
  _count: { select: { spreadsheets: true } },
} as const;

/**
 * Users, status and the ADMIN role. Invariants, checked inside a transaction that locks
 * every ADMIN assignment (so two admins acting at once cannot both win):
 * - nobody changes their own status or role (another admin must do it);
 * - there is always at least one ACTIVE admin;
 * - an admin granted by ADMIN_EMAILS is not demoted here (the next login would re-grant).
 * Blocking revokes every session of the user immediately.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger('AdminAudit');

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async list(
    actor: Actor,
    query: UserQuery,
  ): Promise<{ items: AdminUserView[]; total: number }> {
    const q = query.q?.trim();
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { roles: { some: { role: { name: query.role } } } } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { profile: { firstName: { contains: q, mode: 'insensitive' } } },
              { profile: { lastName: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map((row) => this.view(actor, row)), total };
  }

  async setStatus(actor: Actor, id: string, status: UserStatus): Promise<AdminUserView> {
    this.notSelf(actor, id);
    await this.locked(actor, async (tx) => {
      const target = await this.target(tx, id);
      if (target.status === status) return;
      const isAdmin = target.roles.some(({ role }) => role.name === 'ADMIN');
      if (status === 'BLOCKED' && isAdmin) await this.keepAnAdmin(tx, id);
      await tx.user.update({ where: { id }, data: { status } });
    });
    if (status === 'BLOCKED') await this.auth.revokeAllSessions(id, 'blocked_by_admin');
    this.logger.log(`admin ${actor.id} set status ${status} on user ${id}`);
    return this.one(actor, id);
  }

  async setAdmin(actor: Actor, id: string, admin: boolean): Promise<AdminUserView> {
    this.notSelf(actor, id);
    await this.locked(actor, async (tx) => {
      const target = await this.target(tx, id);
      const role = await tx.role.upsert({
        where: { name: 'ADMIN' },
        create: { name: 'ADMIN', description: 'Controle completo da plataforma.' },
        update: {},
      });
      const isAdmin = target.roles.some(({ role: r }) => r.name === 'ADMIN');
      if (admin) {
        if (target.status !== 'ACTIVE') {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'user_blocked',
            'Desbloqueie a conta antes de torná-la administradora.',
          );
        }
        if (!isAdmin) await tx.userRole.create({ data: { userId: id, roleId: role.id } });
        return;
      }
      if (!isAdmin) return;
      if (this.env.ADMIN_EMAILS.includes(target.email)) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'admin_from_environment',
          'Este administrador vem de ADMIN_EMAILS e voltaria a ser admin no próximo login. Remova o e-mail da variável primeiro.',
        );
      }
      await this.keepAnAdmin(tx, id);
      await tx.userRole.delete({
        where: { userId_roleId: { userId: id, roleId: role.id } },
      });
    });
    this.logger.log(`admin ${actor.id} set admin=${admin} on user ${id}`);
    return this.one(actor, id);
  }

  // ─────────────────────────── Internals ───────────────────────────

  private notSelf(actor: Actor, id: string): void {
    if (actor.id === id) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'admin_self_change',
        'Você não pode alterar a própria conta aqui; peça a outro administrador.',
      );
    }
  }

  /**
   * Runs `work` holding a lock on every ADMIN assignment, after confirming the actor is
   * still an active admin (a concurrent change may have removed them).
   */
  private async locked(actor: Actor, work: (tx: Tx) => Promise<void>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const admins = await tx.$queryRaw<{ user_id: string; status: UserStatus }[]>`
        SELECT ur.user_id, u.status
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        JOIN users u ON u.id = ur.user_id
        WHERE r.name = 'ADMIN'
        FOR UPDATE OF ur`;
      const actorIsAdmin = admins.some(
        (row) => row.user_id === actor.id && row.status === 'ACTIVE',
      );
      if (!actorIsAdmin) throw new ApiException(HttpStatus.FORBIDDEN, 'forbidden');
      await work(tx);
    });
  }

  /** At least one other ACTIVE admin must remain. */
  private async keepAnAdmin(tx: Tx, leaving: string): Promise<void> {
    const others = await tx.user.count({
      where: {
        id: { not: leaving },
        status: 'ACTIVE',
        roles: { some: { role: { name: 'ADMIN' } } },
      },
    });
    if (others === 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'last_admin',
        'É preciso manter ao menos um administrador ativo.',
      );
    }
  }

  private async target(tx: Tx, id: string) {
    const user = await tx.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new ResourceNotFoundException();
    return user;
  }

  private async one(actor: Actor, id: string): Promise<AdminUserView> {
    const row = await this.prisma.user.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new ResourceNotFoundException();
    return this.view(actor, row);
  }

  private view(
    actor: Actor,
    row: Prisma.UserGetPayload<{ include: typeof INCLUDE }>,
  ): AdminUserView {
    const name = [row.profile?.firstName, row.profile?.lastName]
      .filter(Boolean)
      .join(' ');
    return {
      id: row.id,
      email: row.email,
      name: name || null,
      status: row.status,
      roles: row.roles.map(({ role }) => role.name).sort() as ('ADMIN' | 'USER')[],
      adminFromEnvironment: this.env.ADMIN_EMAILS.includes(row.email),
      isSelf: row.id === actor.id,
      googleConnection: row.googleConnection?.status ?? null,
      spreadsheets: row._count.spreadsheets,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
