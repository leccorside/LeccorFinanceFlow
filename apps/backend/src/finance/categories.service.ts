import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { defined } from '../common/validation/defined.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  AppLocale,
  Category,
  CategoryKind,
  TransactionType,
} from '../generated/prisma/client.js';
import {
  ActionHistoryService,
  diffSnapshots,
  snapshotOf,
} from './action-history.service.js';
import {
  type CreateCategoryInput,
  ruleViolation,
  type UpdateCategoryInput,
} from './finance.schemas.js';
import { userSettings } from './user-settings.js';

type User = Pick<AuthenticatedUser, 'id'>;

/** System category names per locale (pt-BR is also stored in the database). */
export const SYSTEM_CATEGORY_NAMES: Record<string, Record<AppLocale, string>> = {
  food: { pt_BR: 'Alimentação', en_US: 'Food', es_ES: 'Alimentación' },
  housing: { pt_BR: 'Moradia', en_US: 'Housing', es_ES: 'Vivienda' },
  transport: { pt_BR: 'Transporte', en_US: 'Transportation', es_ES: 'Transporte' },
  health: { pt_BR: 'Saúde', en_US: 'Health', es_ES: 'Salud' },
  education: { pt_BR: 'Educação', en_US: 'Education', es_ES: 'Educación' },
  leisure: { pt_BR: 'Lazer', en_US: 'Leisure', es_ES: 'Ocio' },
  subscriptions: { pt_BR: 'Assinaturas', en_US: 'Subscriptions', es_ES: 'Suscripciones' },
  shopping: { pt_BR: 'Compras', en_US: 'Shopping', es_ES: 'Compras' },
  bills: { pt_BR: 'Contas', en_US: 'Bills', es_ES: 'Facturas' },
  travel: { pt_BR: 'Viagens', en_US: 'Travel', es_ES: 'Viajes' },
  investments: { pt_BR: 'Investimentos', en_US: 'Investments', es_ES: 'Inversiones' },
  salary: { pt_BR: 'Salário', en_US: 'Salary', es_ES: 'Salario' },
  freelance: { pt_BR: 'Freelance', en_US: 'Freelance', es_ES: 'Freelance' },
  other: { pt_BR: 'Outros', en_US: 'Other', es_ES: 'Otros' },
};

/** Which category kinds each transaction type accepts (GENERAL fits any). */
export const KINDS_FOR_TYPE: Record<TransactionType, CategoryKind[]> = {
  INCOME: ['INCOME', 'GENERAL'],
  EXPENSE: ['EXPENSE', 'GENERAL'],
  INVESTMENT: ['INVESTMENT', 'GENERAL'],
  TRANSFER: [],
};

export interface CategoryResponse {
  id: string;
  /** Localized for system categories, as typed for the user's own. */
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  systemKey: string | null;
  isSystem: boolean;
  color: string | null;
  icon: string | null;
  isArchived: boolean;
}

export function displayName(
  category: Pick<Category, 'name' | 'systemKey'>,
  locale: AppLocale,
): string {
  return (
    (category.systemKey && SYSTEM_CATEGORY_NAMES[category.systemKey]?.[locale]) ??
    category.name
  );
}

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActionHistoryService) private readonly history: ActionHistoryService,
  ) {}

  /** System categories (shared) + the user's own. */
  async list(
    user: User,
    filter: { kind?: CategoryKind; includeArchived?: boolean } = {},
  ): Promise<CategoryResponse[]> {
    const { locale } = await userSettings(this.prisma, user.id);
    const rows = await this.prisma.category.findMany({
      where: {
        OR: [{ ownerId: null }, ownedBy(user)],
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.includeArchived ? {} : { isArchived: false }),
      },
      orderBy: [{ ownerId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    return rows.map((row) => toResponse(row, locale));
  }

  /** A category the user may USE: a system one or their own. 404 otherwise. */
  async findUsable(user: User, id: string): Promise<Category> {
    const row = await this.prisma.category.findFirst({
      where: { id, OR: [{ ownerId: null }, ownedBy(user)] },
    });
    if (!row) throw new ResourceNotFoundException();
    return row;
  }

  /** A category the user may CHANGE: only their own (system ones answer 403). */
  private async findEditable(user: User, id: string): Promise<Category> {
    const row = await this.findUsable(user, id);
    if (row.ownerId === null) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'category_read_only',
        'Categorias padrão não podem ser alteradas. Crie uma categoria sua.',
      );
    }
    return row;
  }

  async create(user: User, input: CreateCategoryInput): Promise<CategoryResponse> {
    const { locale } = await userSettings(this.prisma, user.id);
    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await this.findUsable(user, parentId);
      if (parent.parentId !== null) {
        throw ruleViolation(
          'category_too_deep',
          'Subcategorias não podem ter outras subcategorias.',
        );
      }
      if (parent.kind !== input.kind && parent.kind !== 'GENERAL') {
        throw ruleViolation(
          'category_kind_mismatch',
          'A subcategoria precisa ser do mesmo tipo da categoria pai.',
        );
      }
    }
    await this.assertNameFree(user, input.name, parentId, locale);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          ownerId: user.id,
          name: input.name,
          kind: input.kind,
          parentId,
          color: input.color ?? null,
          icon: input.icon ?? null,
        },
      });
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'CATEGORY',
        entityId: created.id,
        action: 'CREATE',
        after: snapshotOf(created),
      });
      return created;
    });
    return toResponse(row, locale);
  }

  async update(
    user: User,
    id: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryResponse> {
    const { locale } = await userSettings(this.prisma, user.id);
    const current = await this.findEditable(user, id);
    if (
      input.name !== undefined &&
      input.name.toLowerCase() !== current.name.toLowerCase()
    ) {
      await this.assertNameFree(user, input.name, current.parentId, locale, id);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({ where: { id }, data: defined(input) });
      const diff = diffSnapshots(snapshotOf(current), snapshotOf(updated));
      if (diff) {
        await this.history.record(tx, {
          ownerId: user.id,
          entityType: 'CATEGORY',
          entityId: id,
          action: 'UPDATE',
          ...diff,
        });
      }
      return updated;
    });
    return toResponse(row, locale);
  }

  /** Only unused own categories can be deleted; otherwise archive them. */
  async delete(user: User, id: string): Promise<void> {
    const current = await this.findEditable(user, id);
    const [children, transactions, recurrences, installments] = await Promise.all([
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.transaction.count({ where: { ...ownedBy(user), categoryId: id } }),
      this.prisma.recurringTransaction.count({
        where: { ...ownedBy(user), categoryId: id },
      }),
      this.prisma.installment.count({ where: { ...ownedBy(user), categoryId: id } }),
    ]);
    if (children + transactions + recurrences + installments > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'category_in_use',
        'A categoria está em uso. Arquive-a em vez de excluir.',
        {
          subcategories: children,
          transactions,
        },
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id } });
      await this.history.record(tx, {
        ownerId: user.id,
        entityType: 'CATEGORY',
        entityId: id,
        action: 'DELETE',
        before: snapshotOf(current),
      });
    });
  }

  /** Names are unique per owner and parent, ignoring case, also against system names. */
  private async assertNameFree(
    user: User,
    name: string,
    parentId: string | null,
    locale: AppLocale,
    exceptId?: string,
  ) {
    const siblings = await this.prisma.category.findMany({
      where: {
        parentId,
        OR: [{ ownerId: null }, ownedBy(user)],
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { name: true, systemKey: true },
    });
    const wanted = name.trim().toLocaleLowerCase();
    if (
      siblings.some((sibling) =>
        [sibling.name, displayName(sibling, locale)].some(
          (candidate) => candidate.toLocaleLowerCase() === wanted,
        ),
      )
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'category_name_taken',
        'Já existe uma categoria com esse nome.',
      );
    }
  }
}

function toResponse(row: Category, locale: AppLocale): CategoryResponse {
  return {
    id: row.id,
    name: displayName(row, locale),
    kind: row.kind,
    parentId: row.parentId,
    systemKey: row.systemKey,
    isSystem: row.ownerId === null,
    color: row.color,
    icon: row.icon,
    isArchived: row.isArchived,
  };
}
