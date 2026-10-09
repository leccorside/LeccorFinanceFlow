import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type ActionEntityType,
  type ActionKind,
  Prisma,
} from '../generated/prisma/client.js';

type Json = Prisma.InputJsonValue;
type Snapshot = Record<string, Json | null>;

/** Fields that never go into snapshots (sync bookkeeping and ownership are not user data). */
const EXCLUDED = new Set([
  'ownerId',
  'syncStatus',
  'syncError',
  'createdAt',
  'updatedAt',
]);

/** JSON-safe snapshot: Decimal → string, Date → ISO string. */
export function snapshotOf(row: Record<string, unknown>): Snapshot {
  const snapshot: Snapshot = {};
  for (const [key, value] of Object.entries(row)) {
    if (EXCLUDED.has(key)) continue;
    snapshot[key] = toJson(value);
  }
  return snapshot;
}

function toJson(value: unknown): Json | null {
  if (value === null || value === undefined) return null;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toJson(item)) as Json;
  return value as Json;
}

/** Minimal before/after for an UPDATE: only the fields that changed. */
export function diffSnapshots(
  before: Snapshot,
  after: Snapshot,
): { before: Snapshot; after: Snapshot } | null {
  const changedBefore: Snapshot = {};
  const changedAfter: Snapshot = {};
  for (const key of Object.keys(after)) {
    if (key === 'version') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key] ?? null;
      changedAfter[key] = after[key] ?? null;
    }
  }
  return Object.keys(changedAfter).length === 0
    ? null
    : { before: changedBefore, after: changedAfter };
}

export interface ActionRecord {
  ownerId: string;
  entityType: ActionEntityType;
  entityId: string;
  action: ActionKind;
  before?: Snapshot | null;
  after?: Snapshot | null;
  conversationId?: string | null;
}

export interface ActionHistoryItem {
  id: string;
  entityType: ActionEntityType;
  entityId: string;
  action: ActionKind;
  before: unknown;
  after: unknown;
  isReversible: boolean;
  revertedAt: string | null;
  createdAt: string;
}

/**
 * Functional history for undo (PASSO 15) and user-facing audit. NOT a technical log:
 * one entry per user-visible change, written in the same database transaction as the change.
 */
@Injectable()
export class ActionHistoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(tx: Prisma.TransactionClient, entry: ActionRecord): Promise<void> {
    await tx.actionHistory.create({
      data: {
        ownerId: entry.ownerId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        beforeState: entry.before ?? Prisma.DbNull,
        afterState: entry.after ?? Prisma.DbNull,
        conversationId: entry.conversationId ?? null,
      },
    });
  }

  async list(
    user: Pick<AuthenticatedUser, 'id'>,
    limit = 50,
  ): Promise<ActionHistoryItem[]> {
    const rows = await this.prisma.actionHistory.findMany({
      where: ownedBy(user),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((row) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      before: row.beforeState,
      after: row.afterState,
      isReversible: row.isReversible,
      revertedAt: row.revertedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
