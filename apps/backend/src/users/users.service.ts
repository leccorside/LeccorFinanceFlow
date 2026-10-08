import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.errors.js';
import type { GoogleIdentity } from '../auth/google-identity.provider.js';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type User } from '../generated/prisma/client.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /**
   * Finds the user for a verified Google identity, linking by e-mail or creating
   * a new USER account. The e-mail of an existing account is never overwritten here.
   */
  async resolveGoogleUser(identity: GoogleIdentity): Promise<User> {
    let user: User;
    try {
      user = await this.findOrCreate(identity);
    } catch (error) {
      // Two simultaneous first logins: the loser hits a unique violation; retry finds the winner.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        user = await this.findOrCreate(identity);
      } else {
        throw error;
      }
    }

    await this.grantConfiguredAdmin(user);
    return user;
  }

  /**
   * Bootstrap of administrators: accounts whose e-mail is in ADMIN_EMAILS receive ADMIN
   * on login. Grants are additive; removing an e-mail from the list does not demote
   * (demotion is an explicit admin action, PASSO 20).
   */
  private async grantConfiguredAdmin(user: User): Promise<void> {
    if (!this.env.ADMIN_EMAILS.includes(user.email)) {
      return;
    }
    const admin = await this.prisma.role.upsert({
      where: { name: 'ADMIN' },
      create: { name: 'ADMIN', description: 'Controle completo da plataforma.' },
      update: {},
    });
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: admin.id } },
      create: { userId: user.id, roleId: admin.id },
      update: {},
    });
  }

  private async findOrCreate(identity: GoogleIdentity): Promise<User> {
    const email = normalizeEmail(identity.email);

    const bySubject = await this.prisma.user.findUnique({
      where: { googleSubject: identity.subject },
    });
    if (bySubject) {
      return bySubject;
    }

    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.googleSubject !== null) {
        // Same e-mail already bound to a different Google account.
        throw new AuthError('account_conflict');
      }
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: { googleSubject: identity.subject },
      });
    }

    return this.prisma.user.create({
      data: {
        email,
        googleSubject: identity.subject,
        roles: {
          create: {
            role: {
              connectOrCreate: {
                where: { name: 'USER' },
                create: {
                  name: 'USER',
                  description: 'Controle apenas sobre os próprios dados financeiros.',
                },
              },
            },
          },
        },
        profile: {
          create: {
            firstName: identity.givenName?.slice(0, 100) ?? null,
            lastName: identity.familyName?.slice(0, 100) ?? null,
            photoUrl: identity.picture?.slice(0, 2048) ?? null,
          },
        },
      },
    });
  }
}
