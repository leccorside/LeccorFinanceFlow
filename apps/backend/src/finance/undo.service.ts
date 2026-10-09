import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type ActionEntityType,
  type ActionHistory,
  type ActionKind,
  Prisma,
} from '../generated/prisma/client.js';
import {
  ActionHistoryService,
  type ActionRecord,
  snapshotOf,
} from './action-history.service.js';
import { ruleViolation } from './finance.schemas.js';

type User = Pick<AuthenticatedUser, 'id'>;
type Snapshot = Record<string, unknown>;

/** Minimal Prisma delegate used generically by the reverters. */
interface Delegate {
  findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  delete(args: { where: { id: string } }): Promise<Record<string, unknown>>;
}

interface EntityConfig {
  model:
    | 'transaction'
    | 'financialAccount'
    | 'category'
    | 'investment'
    | 'recurringTransaction'
    | 'installment';
  hasVersion: boolean;
  hasSync: boolean;
}

const ENTITIES: Partial<Record<ActionEntityType, EntityConfig>> = {
  TRANSACTION: { model: 'transaction', hasVersion: true, hasSync: true },
  FINANCIAL_ACCOUNT: { model: 'financialAccount', hasVersion: true, hasSync: true },
  CATEGORY: { model: 'category', hasVersion: false, hasSync: false },
  INVESTMENT: { model: 'investment', hasVersion: true, hasSync: true },
  RECURRING_TRANSACTION: {
    model: 'recurringTransaction',
    hasVersion: true,
    hasSync: false,
  },
  INSTALLMENT: { model: 'installment', hasVersion: false, hasSync: false },
};

/** Keys that are not columns of the entity (nested data written next to the snapshot). */
const EXTRA_KEYS = new Set([
  'parcels',
  'occurrences',
  'updatedOccurrences',
  'deletedOccurrences',
]);

export interface UndoneAction {
  historyId: string;
  entityType: ActionEntityType;
  entityId: string;
  /** What was undone (the original action). */
  action: ActionKind;
  /** Description or name of the record, when there is one. */
  label: string | null;
}

export interface UndoResult {
  undone: UndoneAction[];
}

/**
 * Undo of the user's latest eligible action, from the functional history (no technical log).
 * One action = every history row of the same database transaction (`batch_id`), reverted
 * together, newest first:
 *
 * - CREATE → the record is deleted (only if nobody changed it since);
 * - UPDATE → the changed fields go back to their previous values (same condition);
 * - DELETE → the record is recreated from its snapshot, with the same id.
 *
 * The undo itself is written to the history as non-reversible audit rows (`undo_of_id`), so a
 * second "undo" goes further back instead of redoing.
 */
@Injectable()
export class UndoService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActionHistoryService) private readonly history: ActionHistoryService,
  ) {}

  async undoLast(
    user: User,
    context: { conversationId?: string } = {},
  ): Promise<UndoResult> {
    const latest = await this.prisma.actionHistory.findFirst({
      where: { ownerId: user.id, revertedAt: null, undoOfId: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!latest) {
      throw ruleViolation('nothing_to_undo', 'Não há nenhuma alteração para desfazer.');
    }
    const rows = latest.batchId
      ? await this.prisma.actionHistory.findMany({
          where: {
            ownerId: user.id,
            batchId: latest.batchId,
            revertedAt: null,
            undoOfId: null,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      : [latest];
    if (rows.some((row) => !row.isReversible || !ENTITIES[row.entityType])) {
      throw ruleViolation(
        'undo_irreversible',
        'A última alteração não pode ser desfeita automaticamente.',
        { entityType: latest.entityType, action: latest.action },
      );
    }

    // Labels come from the records while reverting (an UPDATE row only has changed fields).
    const labels = new Map<string, string | null>();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Claim first: a concurrent undo of the same action waits here and then finds nothing.
        const { count } = await tx.actionHistory.updateMany({
          where: { id: { in: rows.map((row) => row.id) }, revertedAt: null },
          data: { revertedAt: new Date() },
        });
        if (count !== rows.length) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'undo_in_progress',
            'Essa alteração já está sendo desfeita.',
          );
        }
        for (const row of rows)
          labels.set(row.id, await this.revert(tx, user, row, context));
      });
    } catch (error) {
      throw undoFailure(error);
    }
    return { undone: rows.map((row) => describe(row, labels.get(row.id) ?? null)) };
  }

  /** Reverts one history row; returns the record's description or name. */
  private async revert(
    tx: Prisma.TransactionClient,
    user: User,
    row: ActionHistory,
    context: { conversationId?: string },
  ): Promise<string | null> {
    const config = ENTITIES[row.entityType] as EntityConfig;
    const delegate = (tx as unknown as Record<string, Delegate>)[
      config.model
    ] as Delegate;
    const audit = (action: ActionKind, before: Snapshot | null, after: Snapshot | null) =>
      this.history.record(tx, {
        ownerId: user.id,
        entityType: row.entityType,
        entityId: row.entityId,
        action,
        before: before as NonNullable<ActionRecord['before']> | null,
        after: after as NonNullable<ActionRecord['after']> | null,
        conversationId: context.conversationId ?? null,
        undoOfId: row.id,
      });
    const current = await delegate.findUnique({ where: { id: row.entityId } });

    if (row.action === 'CREATE') {
      const after = (row.afterState ?? {}) as Snapshot;
      if (!current || !matches(current, after)) throw changed();
      if (row.entityType === 'INSTALLMENT')
        await this.dropParcels(tx, row.entityId, after);
      if (row.entityType === 'RECURRING_TRANSACTION') {
        await this.dropUntouchedOccurrences(tx, current);
      }
      await delegate.delete({ where: { id: row.entityId } });
      await audit('DELETE', snapshotOf(current), null);
      return labelOf(current);
    }

    if (row.action === 'UPDATE') {
      const before = (row.beforeState ?? {}) as Snapshot;
      const after = (row.afterState ?? {}) as Snapshot;
      if (!current || !matches(current, after)) throw changed();
      const restored = await delegate.update({
        where: { id: row.entityId },
        data: {
          ...columns(before),
          ...(config.hasVersion ? { version: { increment: 1 } } : {}),
          ...(config.hasSync ? { syncStatus: 'PENDING_SYNC', syncError: null } : {}),
        },
      });
      if (row.entityType === 'RECURRING_TRANSACTION') {
        await this.restoreOccurrences(tx, user, before, after);
      }
      const keys = Object.keys(columns(before));
      await audit(
        'UPDATE',
        pick(snapshotOf(current), keys),
        pick(snapshotOf(restored), keys),
      );
      return labelOf(restored);
    }

    // DELETE: recreate with the same id.
    const before = (row.beforeState ?? {}) as Snapshot;
    if (current) throw changed();
    const created = await delegate.create({
      data: await this.recreatable(tx, user, before, config),
    });
    if (row.entityType === 'INSTALLMENT') {
      for (const parcel of (before.parcels as Snapshot[] | undefined) ?? []) {
        await tx.transaction.create({
          data: (await this.recreatable(
            tx,
            user,
            parcel,
            ENTITIES.TRANSACTION as EntityConfig,
          )) as Prisma.TransactionUncheckedCreateInput,
        });
      }
    }
    if (row.entityType === 'RECURRING_TRANSACTION') {
      for (const occurrence of (before.occurrences as Snapshot[] | undefined) ?? []) {
        if (await tx.transaction.findUnique({ where: { id: String(occurrence.id) } }))
          continue;
        await tx.transaction.create({
          data: (await this.recreatable(
            tx,
            user,
            occurrence,
            ENTITIES.TRANSACTION as EntityConfig,
          )) as Prisma.TransactionUncheckedCreateInput,
        });
      }
    }
    await audit('CREATE', null, snapshotOf(created));
    return labelOf(created);
  }

  /** A snapshot as create data: own columns, the owner, a new version, pending sync. */
  private async recreatable(
    tx: Prisma.TransactionClient,
    user: User,
    snapshot: Snapshot,
    config: EntityConfig,
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = { ...columns(snapshot) };
    if (config.model !== 'category') data.ownerId = user.id;
    else if (snapshot.systemKey === null || snapshot.systemKey === undefined)
      data.ownerId = user.id;
    if (config.hasVersion && typeof data.version === 'number')
      data.version = data.version + 1;
    if (config.hasSync) data.syncStatus = 'PENDING_SYNC';
    // A spreadsheet deleted meanwhile is simply not linked any more.
    if (typeof data.spreadsheetId === 'string') {
      const exists = await tx.spreadsheet.count({
        where: { id: data.spreadsheetId, ownerId: user.id },
      });
      if (!exists) data.spreadsheetId = null;
    }
    return data;
  }

  /** Undo of an installment purchase: only when no parcel changed since it was created. */
  private async dropParcels(
    tx: Prisma.TransactionClient,
    installmentId: string,
    after: Snapshot,
  ): Promise<void> {
    const expected = (after.parcels as Snapshot[] | undefined) ?? [];
    const parcels = await tx.transaction.findMany({ where: { installmentId } });
    const byId = new Map(parcels.map((parcel) => [parcel.id, parcel]));
    if (
      parcels.length !== expected.length ||
      expected.some((parcel) => {
        const now = byId.get(String(parcel.id));
        return !now || !matches(now, parcel);
      })
    ) {
      throw changed();
    }
    await tx.transaction.deleteMany({ where: { installmentId } });
  }

  /** Undo of a recurrence: its generated, still pending and unedited occurrences go too. */
  private async dropUntouchedOccurrences(
    tx: Prisma.TransactionClient,
    rule: Record<string, unknown>,
  ): Promise<void> {
    await tx.transaction.deleteMany({
      where: {
        recurringTransactionId: String(rule.id),
        status: 'PENDING',
        amount: rule.amount as Prisma.Decimal,
        description: String(rule.description),
        accountId: (rule.accountId as string | null) ?? null,
        categoryId: (rule.categoryId as string | null) ?? null,
      },
    });
  }

  /** Occurrences a recurrence update changed or removed come back as they were. */
  private async restoreOccurrences(
    tx: Prisma.TransactionClient,
    user: User,
    before: Snapshot,
    after: Snapshot,
  ): Promise<void> {
    const snapshots = new Map(
      ((before.occurrences as Snapshot[] | undefined) ?? []).map((item) => [
        String(item.id),
        item,
      ]),
    );
    for (const id of (after.updatedOccurrences as string[] | undefined) ?? []) {
      const snapshot = snapshots.get(id);
      if (!snapshot || !(await tx.transaction.findUnique({ where: { id } }))) continue;
      const { id: _id, version: _version, ...fields } = columns(snapshot);
      void _id;
      void _version;
      await tx.transaction.update({
        where: { id },
        data: {
          ...fields,
          version: { increment: 1 },
          syncStatus: 'PENDING_SYNC',
        } as Prisma.TransactionUncheckedUpdateInput,
      });
    }
    for (const id of (after.deletedOccurrences as string[] | undefined) ?? []) {
      const snapshot = snapshots.get(id);
      if (!snapshot || (await tx.transaction.findUnique({ where: { id } }))) continue;
      await tx.transaction.create({
        data: (await this.recreatable(
          tx,
          user,
          snapshot,
          ENTITIES.TRANSACTION as EntityConfig,
        )) as Prisma.TransactionUncheckedCreateInput,
      });
    }
  }
}

/** Own scalar columns of a snapshot (relations and nested extras dropped). */
function columns(snapshot: Snapshot): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(snapshot).filter(
      ([key, value]) =>
        !EXTRA_KEYS.has(key) &&
        !(value !== null && typeof value === 'object' && !Array.isArray(value)) &&
        !(
          Array.isArray(value) &&
          value.some((item) => item !== null && typeof item === 'object')
        ),
    ),
  );
}

function pick(snapshot: Snapshot, keys: string[]): Snapshot {
  return Object.fromEntries(keys.map((key) => [key, snapshot[key] ?? null]));
}

/** The record still holds the values the action left (nobody changed it since). */
function matches(current: Record<string, unknown>, expected: Snapshot): boolean {
  const now = snapshotOf(current);
  // Content, not version: an earlier undo restores the content but bumps the version.
  return Object.keys(columns(expected))
    .filter((key) => key !== 'version')
    .every(
      (key) => JSON.stringify(now[key] ?? null) === JSON.stringify(expected[key] ?? null),
    );
}

function changed(): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'undo_target_changed',
    'O registro foi alterado depois dessa ação; desfazer agora apagaria essa mudança. Edite-o diretamente.',
  );
}

function undoFailure(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2002', 'P2003', 'P2025'].includes(error.code)
  ) {
    return new ApiException(
      HttpStatus.CONFLICT,
      'undo_not_possible',
      'Não dá para desfazer: dados relacionados mudaram (por exemplo, a conta já tem movimentações ou o nome já está em uso).',
    );
  }
  return error;
}

function labelOf(record: Record<string, unknown>): string | null {
  const label = record.description ?? record.name;
  return typeof label === 'string' ? label : null;
}

function describe(row: ActionHistory, label: string | null): UndoneAction {
  return {
    historyId: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    label,
  };
}
