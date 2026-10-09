import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import {
  ApiException,
  ResourceNotFoundException,
} from '../../common/errors/api-error.js';
import { ownedBy } from '../../common/security/ownership.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AccountsService } from '../../finance/accounts.service.js';
import { displayName } from '../../finance/categories.service.js';
import { InvestmentsService } from '../../finance/investments.service.js';
import { TransactionsService } from '../../finance/transactions.service.js';
import { userSettings } from '../../finance/user-settings.js';
import {
  Prisma,
  type Spreadsheet,
  type SpreadsheetRowState,
  type SyncStatus,
} from '../../generated/prisma/client.js';
import { toLocaleTag } from '../../profile/profile.schemas.js';
import {
  type CellValue,
  GOOGLE_WORKSPACE_CLIENT,
  GoogleApiError,
  type GoogleWorkspaceClient,
  type SheetsRequest,
  type SpreadsheetSnapshot,
} from '../google-workspace.client.js';
import { quoteSheet } from '../spreadsheet-setup.js';
import { type TabKey, tabSpec, TEXTS } from '../spreadsheet-template.js';
import { SpreadsheetsService, toApiException } from '../spreadsheets.service.js';
import {
  AccountsAdapter,
  categoryRows,
  type DataTab,
  InvestmentsAdapter,
  rowErrorOf,
  type SyncContext,
  type SyncRecord,
  type TabAdapter,
  TransactionsAdapter,
} from './adapters.js';
import {
  cellData,
  type Cell,
  dateTimeToSerial,
  isEmpty,
  isUuid,
  type RowCells,
  rowHash,
  sameCells,
} from './cells.js';

type User = Pick<AuthenticatedUser, 'id'>;

/** Accounts first: rows of the other tabs may reference accounts created in the sheet. */
const DATA_TABS: DataTab[] = ['accounts', 'investments', 'transactions'];
const SYNCED_TABS: TabKey[] = [...DATA_TABS, 'categories'];
/** A sync claim older than this is considered abandoned (crashed process). */
const CLAIM_TTL_MS = 5 * 60_000;
/** Detail lists in reports are capped (the counts are not). */
const MAX_LISTED = 50;

export type SyncOutcome = 'SYNCED' | 'PENDING_SYNC' | 'CONFLICT';

export interface RowIssue {
  tab: TabKey;
  /** 1-based row number, as shown in Google Sheets. */
  row: number;
  code: string;
  column?: string;
}

export interface SyncReport {
  /** SYNCED only when every record is in the sheet and no conflict is open. */
  status: SyncOutcome;
  syncedAt: string;
  imported: { created: number; updated: number };
  exported: { written: number; appended: number; removed: number };
  conflicts: number;
  pending: number;
  /** Rows that need the user: not imported (invalid), unknown ID, or duplicated ID. */
  invalidRows: RowIssue[];
  orphanedRows: RowIssue[];
  duplicateRows: RowIssue[];
}

export interface SyncConflict {
  tab: DataTab;
  recordId: string;
  /** `concurrent_edit`, `unknown_baseline` or `invalid_row:<code>`. */
  reason: string;
  sheetValues: RowCells;
  appValues: RowCells;
}

export interface SyncStatusResponse {
  spreadsheetId: string;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  inProgress: boolean;
  pending: Record<DataTab, number>;
  conflicts: SyncConflict[];
  lastReport: SyncReport | null;
}

interface TabLayout {
  sheetId: number;
  title: string;
  rowCount: number;
  columns: Map<string, number>;
}

interface SheetRow {
  /** 0-based grid row index (the header is row 0). */
  index: number;
  cells: RowCells;
  id: string | null;
}

/** What to write for one record: an existing row, or a new row at the end. */
interface Write {
  tab: DataTab;
  recordId: string;
  index: number | null;
  row: SheetRow | null;
}

interface Conflict {
  tab: DataTab;
  recordId: string;
  reason: string;
  cells: RowCells;
  stateId: string | null;
}

/**
 * Bidirectional sync between PostgreSQL (source of truth) and the active Google spreadsheet,
 * on demand and without queues:
 *
 * 1. reads the row states (what was last exported) and the sheet values;
 * 2. per row: sheet-only edits are imported through the domain services (all rules apply);
 *    app-only changes are exported; edits on both sides become CONFLICT (app value kept,
 *    sheet values stored for reconciliation); a deleted row is exported again;
 * 3. new rows (no ID) are imported once: a retry links them instead of duplicating;
 * 4. one atomic batchUpdate writes everything; states and SYNCED marks are saved only after
 *    Google confirms it.
 */
@Injectable()
export class SheetSyncService {
  private readonly adapters: Record<DataTab, TabAdapter>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SpreadsheetsService) private readonly spreadsheets: SpreadsheetsService,
    @Inject(GOOGLE_WORKSPACE_CLIENT) private readonly workspace: GoogleWorkspaceClient,
    @Inject(TransactionsService) transactions: TransactionsService,
    @Inject(AccountsService) accounts: AccountsService,
    @Inject(InvestmentsService) investments: InvestmentsService,
  ) {
    this.adapters = {
      transactions: new TransactionsAdapter(
        prisma,
        transactions,
      ) as unknown as TabAdapter,
      accounts: new AccountsAdapter(prisma, accounts) as unknown as TabAdapter,
      investments: new InvestmentsAdapter(prisma, investments) as unknown as TabAdapter,
    };
  }

  // ─────────────────────────────── Public API ───────────────────────────────

  async sync(user: User, spreadsheetId: string): Promise<SyncReport> {
    const sheet = await this.activeSpreadsheet(user, spreadsheetId);
    await this.claim(sheet.id);
    try {
      const report = await this.spreadsheets.withGoogleToken(user.id, (token) =>
        this.run(token, user, sheet),
      );
      await this.prisma.spreadsheet.update({
        where: { id: sheet.id },
        data: {
          syncStartedAt: null,
          lastSyncedAt: new Date(report.syncedAt),
          lastErrorCode: null,
          syncCheckpoint: { lastReport: report } as unknown as Prisma.InputJsonValue,
        },
      });
      return report;
    } catch (error) {
      const failure = syncFailure(error);
      const code =
        (failure.getResponse() as { code?: string }).code ?? 'spreadsheet_sync_failed';
      await this.prisma.spreadsheet.update({
        where: { id: sheet.id },
        data: { syncStartedAt: null, lastErrorCode: code },
      });
      throw failure;
    }
  }

  async status(user: User, spreadsheetId: string): Promise<SyncStatusResponse> {
    const sheet = await this.prisma.spreadsheet.findFirst({
      where: { id: spreadsheetId, ...ownedBy(user) },
    });
    if (!sheet) throw new ResourceNotFoundException();
    const [transactions, accounts, investments, states] = await Promise.all([
      this.prisma.transaction.count({
        where: { ...ownedBy(user), syncStatus: 'PENDING_SYNC' },
      }),
      this.prisma.financialAccount.count({
        where: { ...ownedBy(user), syncStatus: 'PENDING_SYNC' },
      }),
      this.prisma.investment.count({
        where: { ...ownedBy(user), syncStatus: 'PENDING_SYNC' },
      }),
      this.prisma.spreadsheetRowState.findMany({
        where: { spreadsheetId: sheet.id, conflictReason: { not: null } },
        orderBy: { updatedAt: 'asc' },
      }),
    ]);
    const ctx = await this.context(user, sheet);
    const conflicts: SyncConflict[] = [];
    for (const tab of DATA_TABS) {
      const own = states.filter((state) => state.tab === tab);
      if (own.length === 0) continue;
      const adapter = this.adapters[tab];
      const records = new Map((await adapter.load(ctx)).map((row) => [row.id, row]));
      for (const state of own) {
        const record = records.get(state.recordId);
        if (!record) continue;
        conflicts.push({
          tab,
          recordId: state.recordId,
          reason: state.conflictReason as string,
          sheetValues: state.conflictValues as RowCells,
          appValues: editableCells(adapter.render(record, ctx), adapter.editable),
        });
      }
    }
    const checkpoint = sheet.syncCheckpoint as { lastReport?: SyncReport } | null;
    return {
      spreadsheetId: sheet.id,
      lastSyncedAt: sheet.lastSyncedAt?.toISOString() ?? null,
      lastErrorCode: sheet.lastErrorCode,
      inProgress:
        sheet.syncStartedAt !== null &&
        sheet.syncStartedAt.getTime() > Date.now() - CLAIM_TTL_MS,
      pending: { transactions, accounts, investments },
      conflicts,
      lastReport: checkpoint?.lastReport ?? null,
    };
  }

  /**
   * Reconciles one conflict. `app` keeps the app's values (the sheet row is overwritten);
   * `sheet` applies the sheet's values through the domain rules (422 if they are invalid).
   * Then runs a sync so the sheet reflects the decision.
   */
  async resolve(
    user: User,
    spreadsheetId: string,
    recordId: string,
    keep: 'app' | 'sheet',
  ): Promise<SyncReport> {
    const sheet = await this.activeSpreadsheet(user, spreadsheetId);
    const state = await this.prisma.spreadsheetRowState.findFirst({
      where: { spreadsheetId: sheet.id, recordId, conflictReason: { not: null } },
    });
    if (!state) throw new ResourceNotFoundException();
    const tab = state.tab as DataTab;
    const adapter = this.adapters[tab];
    const ctx = await this.context(user, sheet);
    const record = (await adapter.load(ctx)).find((row) => row.id === recordId);
    if (!record) throw new ResourceNotFoundException();
    const sheetCells = state.conflictValues as RowCells;
    const sheetHash = rowHash(sheetCells, adapter.editable);

    let version = record.version;
    if (keep === 'sheet') {
      try {
        version = (await adapter.update(ctx, record, sheetCells)) ?? record.version;
      } catch (error) {
        const rowError = rowErrorOf(error);
        if (!rowError) throw error;
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          rowError.code,
          'Os valores da planilha não são válidos para este registro.',
          rowError.column ? { column: rowError.column } : undefined,
        );
      }
    }
    // Baseline = the sheet as it is: the next sync sees an app-side state and rewrites the row.
    await this.prisma.$transaction(async (tx) => {
      await tx.spreadsheetRowState.update({
        where: { id: state.id },
        data: {
          conflictReason: null,
          conflictValues: Prisma.DbNull,
          rowHash: sheetHash,
          exportedVersion: version,
        },
      });
      await setStatus(tx, tab, [recordId], 'PENDING_SYNC');
    });
    return this.sync(user, spreadsheetId);
  }

  // ─────────────────────────────── The sync ───────────────────────────────

  private async run(token: string, user: User, sheet: Spreadsheet): Promise<SyncReport> {
    const fileId = sheet.googleSpreadsheetId as string;
    const snapshot = await this.workspace.getSpreadsheet(token, fileId);
    const layouts = layoutOf(snapshot);
    const values = await this.workspace.getValues(
      token,
      fileId,
      SYNCED_TABS.map((tab) => quoteSheet(layouts[tab].title)),
    );
    const read = Object.fromEntries(
      SYNCED_TABS.map((tab, position) => [
        tab,
        {
          rows: rowsOf(values[position] ?? [], layouts[tab]),
          length: values[position]?.length ?? 0,
        },
      ]),
    ) as Record<TabKey, { rows: SheetRow[]; length: number }>;

    const report: SyncReport = {
      status: 'SYNCED',
      syncedAt: new Date().toISOString(),
      imported: { created: 0, updated: 0 },
      exported: { written: 0, appended: 0, removed: 0 },
      conflicts: 0,
      pending: 0,
      invalidRows: [],
      orphanedRows: [],
      duplicateRows: [],
    };
    let ctx = await this.context(user, sheet);
    const states = await this.prisma.spreadsheetRowState.findMany({
      where: { spreadsheetId: sheet.id },
    });

    // ── Pull: decide every row, import sheet-only edits and new rows. ──
    const writes: Write[] = [];
    const deletes: { tab: DataTab; index: number }[] = [];
    const conflicts: Conflict[] = [];
    const droppedStates: string[] = [];
    const seenByTab = new Map<DataTab, Set<string>>();

    for (const tab of DATA_TABS) {
      const adapter = this.adapters[tab];
      const tabStates = states.filter((state) => state.tab === tab);
      const decided = await this.pullTab(
        sheet,
        adapter,
        ctx,
        read[tab].rows,
        tabStates,
        report,
      );
      writes.push(...decided.writes);
      deletes.push(...decided.deletes);
      conflicts.push(...decided.conflicts);
      droppedStates.push(...decided.droppedStates);
      seenByTab.set(tab, decided.seen);
      if (tab === 'accounts') ctx = await this.context(user, sheet); // new accounts usable
    }

    // Conflicts are facts about the data: record them even if the export fails later.
    await this.prisma.$transaction(async (tx) => {
      for (const conflict of conflicts) {
        const adapter = this.adapters[conflict.tab];
        const data = {
          conflictReason: conflict.reason,
          conflictValues: editableCells(
            conflict.cells,
            adapter.editable,
          ) as Prisma.InputJsonValue,
        };
        if (conflict.stateId) {
          await tx.spreadsheetRowState.update({ where: { id: conflict.stateId }, data });
        } else {
          const record = await this.findVersion(tx, conflict.tab, conflict.recordId);
          await tx.spreadsheetRowState.create({
            data: {
              ...data,
              spreadsheetId: sheet.id,
              tab: conflict.tab,
              recordId: conflict.recordId,
              exportedVersion: record ?? 1,
              rowHash: rowHash(conflict.cells, adapter.editable),
            },
          });
        }
        await setStatus(tx, conflict.tab, [conflict.recordId], 'CONFLICT');
      }
      if (droppedStates.length > 0) {
        await tx.spreadsheetRowState.deleteMany({ where: { id: { in: droppedStates } } });
      }
    });
    report.conflicts = conflicts.length;

    // ── Push: records with no row (new in the app, or row deleted in the sheet). ──
    const records = new Map<DataTab, Map<string, SyncRecord>>();
    const freshStates = new Map(
      (
        await this.prisma.spreadsheetRowState.findMany({
          where: { spreadsheetId: sheet.id },
        })
      ).map((state) => [state.recordId, state]),
    );
    for (const tab of DATA_TABS) {
      const loaded = await this.adapters[tab].load(ctx);
      records.set(tab, new Map(loaded.map((row) => [row.id, row])));
      const seen = seenByTab.get(tab) as Set<string>;
      for (const record of loaded) {
        if (!seen.has(record.id))
          writes.push({ tab, recordId: record.id, index: null, row: null });
      }
    }

    // ── Build the batch. ──
    const nowSerial = dateTimeToSerial(new Date(report.syncedAt), ctx.timeZone);
    const requests: SheetsRequest[] = [];
    const written: { tab: DataTab; record: SyncRecord; hash: string }[] = [];
    const nextRow = Object.fromEntries(
      DATA_TABS.map((tab) => [tab, Math.max(read[tab].length, 1)]),
    ) as Record<DataTab, number>;
    const rowsToWrite = new Map<TabKey, { index: number; cells: RowCells }[]>();

    for (const write of writes) {
      const adapter = this.adapters[write.tab];
      const record = records.get(write.tab)?.get(write.recordId);
      if (!record) continue;
      const state = freshStates.get(record.id);
      if (state?.conflictReason) continue; // still in conflict: leave the sheet row alone
      const cells: RowCells = {
        ...adapter.render(record, ctx),
        record_id: record.id,
        record_version: record.version,
      };
      const allKeys = [...tabSpec(write.tab).columns.map((column) => column.key)].filter(
        (key) => key !== 'synced_at',
      );
      const upToDate =
        write.row !== null &&
        sameCells(write.row.cells, cells, allKeys) &&
        record.syncStatus === 'SYNCED' &&
        state !== undefined &&
        !state.awaitingLink &&
        state.exportedVersion === record.version;
      if (upToDate) continue;

      let index = write.index;
      if (index === null) {
        index = nextRow[write.tab];
        nextRow[write.tab] += 1;
        report.exported.appended += 1;
      } else {
        report.exported.written += 1;
      }
      const list = rowsToWrite.get(write.tab) ?? [];
      list.push({ index, cells: { ...cells, synced_at: nowSerial } });
      rowsToWrite.set(write.tab, list);
      written.push({ tab: write.tab, record, hash: rowHash(cells, adapter.editable) });
    }

    // Categories: generated rows, rewritten only when they differ.
    const categoryWrite = this.categoryWrites(ctx, read.categories, nowSerial);
    if (categoryWrite.length > 0) rowsToWrite.set('categories', categoryWrite);

    for (const tab of SYNCED_TABS) {
      const layout = layouts[tab];
      const rows = rowsToWrite.get(tab) ?? [];
      const highest = Math.max(-1, ...rows.map((row) => row.index));
      if (highest >= layout.rowCount) {
        requests.push({
          appendDimension: {
            sheetId: layout.sheetId,
            dimension: 'ROWS',
            length: highest + 1 - layout.rowCount,
          },
        });
      }
      requests.push(...cellRequests(layout, rows));
    }
    // Deletions last, bottom-up, so earlier indices stay valid.
    for (const remove of [...deletes].sort((a, b) => b.index - a.index)) {
      requests.push({
        deleteDimension: {
          range: {
            sheetId: layouts[remove.tab].sheetId,
            dimension: 'ROWS',
            startIndex: remove.index,
            endIndex: remove.index + 1,
          },
        },
      });
      report.exported.removed += 1;
    }

    if (requests.length > 0)
      await this.workspace.batchUpdate(
        token,
        sheet.googleSpreadsheetId as string,
        requests,
      );

    // ── Confirmed by Google: save the new baseline and mark what is now in the sheet. ──
    await this.prisma.$transaction(async (tx) => {
      for (const item of written) {
        await tx.spreadsheetRowState.upsert({
          where: {
            spreadsheetId_recordId: { spreadsheetId: sheet.id, recordId: item.record.id },
          },
          create: {
            spreadsheetId: sheet.id,
            tab: item.tab,
            recordId: item.record.id,
            exportedVersion: item.record.version,
            rowHash: item.hash,
          },
          update: {
            exportedVersion: item.record.version,
            rowHash: item.hash,
            awaitingLink: false,
            conflictReason: null,
            conflictValues: Prisma.DbNull,
          },
        });
        // Only if nobody changed it meanwhile (otherwise it stays PENDING_SYNC).
        await setStatus(tx, item.tab, [item.record.id], 'SYNCED', item.record.version);
      }
    });

    report.pending = (
      await Promise.all([
        this.prisma.transaction.count({
          where: { ...ownedBy(user), syncStatus: 'PENDING_SYNC' },
        }),
        this.prisma.financialAccount.count({
          where: { ...ownedBy(user), syncStatus: 'PENDING_SYNC' },
        }),
        this.prisma.investment.count({
          where: { ...ownedBy(user), syncStatus: 'PENDING_SYNC' },
        }),
      ])
    ).reduce((sum, count) => sum + count, 0);
    const openConflicts = await this.prisma.spreadsheetRowState.count({
      where: { spreadsheetId: sheet.id, conflictReason: { not: null } },
    });
    report.conflicts = openConflicts;
    report.status =
      openConflicts > 0 ? 'CONFLICT' : report.pending > 0 ? 'PENDING_SYNC' : 'SYNCED';
    report.invalidRows = report.invalidRows.slice(0, MAX_LISTED);
    report.orphanedRows = report.orphanedRows.slice(0, MAX_LISTED);
    report.duplicateRows = report.duplicateRows.slice(0, MAX_LISTED);
    return report;
  }

  private async pullTab(
    sheet: Spreadsheet,
    adapter: TabAdapter,
    ctx: SyncContext,
    rows: SheetRow[],
    states: SpreadsheetRowState[],
    report: SyncReport,
  ) {
    const tab = adapter.tab;
    const records = new Map((await adapter.load(ctx)).map((row) => [row.id, row]));
    const stateById = new Map(states.map((state) => [state.recordId, state]));
    const seen = new Set<string>();
    const writes: Write[] = [];
    const deletes: { tab: DataTab; index: number }[] = [];
    const conflicts: Conflict[] = [];
    const droppedStates: string[] = [];
    const fresh: SheetRow[] = [];
    const issue = (row: SheetRow, code: string, column?: string): RowIssue => ({
      tab,
      row: row.index + 1,
      code,
      ...(column ? { column } : {}),
    });

    for (const row of rows) {
      if (row.id === null) {
        fresh.push(row);
        continue;
      }
      if (seen.has(row.id)) {
        report.duplicateRows.push(issue(row, 'duplicate_id'));
        continue;
      }
      const record = isUuid(row.id) ? records.get(row.id) : undefined;
      const state = stateById.get(row.id);
      if (!record) {
        if (state) {
          // Deleted in the app. An untouched row goes away; an edited one is kept (never
          // imported again: its ID is unknown) so the user's edit is not lost silently.
          if (rowHash(row.cells, adapter.editable) === state.rowHash) {
            deletes.push({ tab, index: row.index });
          } else {
            report.orphanedRows.push(issue(row, 'record_deleted_in_app'));
          }
          droppedStates.push(state.id);
        } else {
          report.orphanedRows.push(issue(row, 'unknown_id'));
        }
        continue;
      }
      seen.add(record.id);
      const hash = rowHash(row.cells, adapter.editable);
      const appHash = rowHash(adapter.render(record, ctx), adapter.editable);

      if (!state || state.conflictReason) {
        // No baseline (sheet reused/copied) or open conflict: only an exact match settles it.
        if (hash === appHash) {
          if (state) droppedStates.push(state.id);
          writes.push({ tab, recordId: record.id, index: row.index, row });
        } else {
          conflicts.push({
            tab,
            recordId: record.id,
            reason: state?.conflictReason ?? 'unknown_baseline',
            cells: row.cells,
            stateId: state?.id ?? null,
          });
        }
        continue;
      }

      const sheetChanged = hash !== state.rowHash;
      const appChanged = record.version !== state.exportedVersion;
      if (sheetChanged && appChanged && hash !== appHash) {
        conflicts.push({
          tab,
          recordId: record.id,
          reason: 'concurrent_edit',
          cells: row.cells,
          stateId: state.id,
        });
        continue;
      }
      if (sheetChanged && !appChanged) {
        try {
          const version = await adapter.update(ctx, record, row.cells);
          if (version !== null) report.imported.updated += 1;
          // The sheet's values are now in the database: they are the new baseline.
          await this.prisma.spreadsheetRowState.update({
            where: { id: state.id },
            data: { rowHash: hash, exportedVersion: version ?? record.version },
          });
        } catch (error) {
          const rowError = rowErrorOf(error);
          if (!rowError) throw error;
          conflicts.push({
            tab,
            recordId: record.id,
            reason: `invalid_row:${rowError.code}`,
            cells: row.cells,
            stateId: state.id,
          });
          continue;
        }
      }
      writes.push({ tab, recordId: record.id, index: row.index, row });
    }

    // New rows: a retry after a failed write-back links instead of creating again.
    const awaiting = states.filter(
      (state) =>
        state.awaitingLink && !seen.has(state.recordId) && records.has(state.recordId),
    );
    for (const row of fresh) {
      const hash = rowHash(row.cells, adapter.editable);
      const match = awaiting.findIndex((state) => state.rowHash === hash);
      if (match >= 0) {
        const [state] = awaiting.splice(match, 1) as [SpreadsheetRowState];
        seen.add(state.recordId);
        writes.push({ tab, recordId: state.recordId, index: row.index, row });
        continue;
      }
      try {
        const created = await adapter.create(ctx, row.cells);
        report.imported.created += 1;
        await this.prisma.spreadsheetRowState.create({
          data: {
            spreadsheetId: sheet.id,
            tab,
            recordId: created.id,
            exportedVersion: created.version,
            rowHash: hash,
            awaitingLink: true,
          },
        });
        seen.add(created.id);
        writes.push({ tab, recordId: created.id, index: row.index, row });
      } catch (error) {
        const rowError = rowErrorOf(error);
        if (!rowError) throw error;
        report.invalidRows.push(issue(row, rowError.code, rowError.column));
      }
    }

    // States whose record and row are both gone.
    for (const state of states) {
      if (!records.has(state.recordId) && !droppedStates.includes(state.id)) {
        droppedStates.push(state.id);
      }
    }
    return { writes, deletes, conflicts, droppedStates, seen };
  }

  private categoryWrites(
    ctx: SyncContext,
    current: { rows: SheetRow[]; length: number },
    nowSerial: number,
  ): { index: number; cells: RowCells }[] {
    const desired = categoryRows(ctx);
    const keys = ['name', 'kind', 'parent', 'record_id'];
    const existing = new Map(current.rows.map((row) => [row.index, row.cells]));
    const lastIndex = Math.max(current.length - 1, desired.length);
    const result: { index: number; cells: RowCells }[] = [];
    let changed = false;
    for (let index = 1; index <= lastIndex; index += 1) {
      const wanted = desired[index - 1];
      const cells: RowCells = wanted
        ? {
            ...wanted.cells,
            record_id: wanted.id,
            record_version: null,
            synced_at: nowSerial,
          }
        : {
            name: null,
            kind: null,
            parent: null,
            record_id: null,
            record_version: null,
            synced_at: null,
          };
      if (!sameCells(existing.get(index) ?? {}, cells, keys)) changed = true;
      result.push({ index, cells });
    }
    return changed ? result : [];
  }

  // ─────────────────────────────── Helpers ───────────────────────────────

  private async activeSpreadsheet(user: User, id: string): Promise<Spreadsheet> {
    const sheet = await this.prisma.spreadsheet.findFirst({
      where: { id, ...ownedBy(user) },
    });
    if (!sheet) throw new ResourceNotFoundException();
    if (sheet.status !== 'ACTIVE' || !sheet.isActive || !sheet.googleSpreadsheetId) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'spreadsheet_not_active',
        'Só a planilha ativa e pronta é sincronizada.',
      );
    }
    return sheet;
  }

  /** One sync per spreadsheet at a time; an abandoned claim expires. */
  private async claim(id: string): Promise<void> {
    const { count } = await this.prisma.spreadsheet.updateMany({
      where: {
        id,
        OR: [
          { syncStartedAt: null },
          { syncStartedAt: { lt: new Date(Date.now() - CLAIM_TTL_MS) } },
        ],
      },
      data: { syncStartedAt: new Date() },
    });
    if (count === 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'spreadsheet_sync_in_progress',
        'A planilha já está sendo sincronizada. Aguarde alguns instantes.',
      );
    }
  }

  private async context(user: User, sheet: Spreadsheet): Promise<SyncContext> {
    const [settings, accounts, categories] = await Promise.all([
      userSettings(this.prisma, user.id),
      this.prisma.financialAccount.findMany({ where: ownedBy(user) }),
      this.prisma.category.findMany({
        where: { OR: [{ ownerId: null }, ownedBy(user)] },
        select: {
          id: true,
          parentId: true,
          kind: true,
          ownerId: true,
          name: true,
          systemKey: true,
        },
      }),
    ]);
    return {
      user: { id: user.id },
      locale: sheet.locale,
      texts: TEXTS[toLocaleTag(sheet.locale)],
      timeZone: settings.timeZone,
      accounts,
      categories: categories.map((category) => ({
        id: category.id,
        parentId: category.parentId,
        kind: category.kind,
        ownerId: category.ownerId,
        name: displayName(category, sheet.locale),
      })),
    };
  }

  private async findVersion(
    tx: Prisma.TransactionClient,
    tab: DataTab,
    id: string,
  ): Promise<number | null> {
    const select = { version: true } as const;
    const row =
      tab === 'transactions'
        ? await tx.transaction.findUnique({ where: { id }, select })
        : tab === 'accounts'
          ? await tx.financialAccount.findUnique({ where: { id }, select })
          : await tx.investment.findUnique({ where: { id }, select });
    return row?.version ?? null;
  }
}

// ─────────────────────────────── Pure helpers ───────────────────────────────

const TABLES: Record<DataTab, Prisma.Sql> = {
  transactions: Prisma.raw('"transactions"'),
  accounts: Prisma.raw('"financial_accounts"'),
  investments: Prisma.raw('"investments"'),
};

/**
 * Sets the sync status of records of one tab (optionally only at a given version). Raw SQL on
 * purpose: bookkeeping must not bump `updated_at` (shown in the sheet as the last change),
 * otherwise every sync would rewrite every row.
 */
async function setStatus(
  tx: Prisma.TransactionClient,
  tab: DataTab,
  ids: string[],
  status: SyncStatus,
  version?: number,
): Promise<void> {
  if (ids.length === 0) return;
  await tx.$executeRaw`
    UPDATE ${TABLES[tab]}
    SET "sync_status" = ${status}::"SyncStatus"${status === 'SYNCED' ? Prisma.sql`, "sync_error" = NULL` : Prisma.empty}
    WHERE "id" = ANY(${ids}::uuid[])${version === undefined ? Prisma.empty : Prisma.sql` AND "version" = ${version}`}`;
}

/** Raw editable cells (stored with conflicts as data; only ever parsed, never executed). */
function editableCells(cells: RowCells, keys: readonly string[]): RowCells {
  return Object.fromEntries(
    keys.map((key) => [key, isEmpty(cells[key]) ? null : (cells[key] ?? null)]),
  );
}

/** Finds the synced tabs and their columns by developer metadata, not by titles. */
export function layoutOf(snapshot: SpreadsheetSnapshot): Record<TabKey, TabLayout> {
  const layouts = {} as Record<TabKey, TabLayout>;
  const missing: string[] = [];
  for (const tab of SYNCED_TABS) {
    const sheet = snapshot.sheets.find((item) => item.tabKey === tab);
    if (!sheet) {
      missing.push(tab);
      continue;
    }
    const columns = new Map(sheet.columns.map((column) => [column.key, column.index]));
    for (const column of tabSpec(tab).columns) {
      if (!columns.has(column.key)) missing.push(`${tab}.${column.key}`);
    }
    layouts[tab] = {
      sheetId: sheet.sheetId,
      title: sheet.title,
      rowCount: sheet.rowCount,
      columns,
    };
  }
  if (missing.length > 0) {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'spreadsheet_structure_invalid',
      'A planilha perdeu abas ou colunas usadas pela sincronização. Recrie a estrutura (POST /spreadsheets).',
      { missing: missing.slice(0, 20) },
    );
  }
  return layouts;
}

/** Sheet values → rows keyed by column key; fully blank rows are skipped. */
export function rowsOf(values: CellValue[][], layout: TabLayout): SheetRow[] {
  const rows: SheetRow[] = [];
  values.forEach((raw, index) => {
    if (index === 0) return; // header
    const cells: RowCells = {};
    for (const [key, column] of layout.columns) {
      const value = raw[column];
      cells[key] = value === undefined || value === '' ? null : (value as Cell);
    }
    if (Object.values(cells).every((cell) => isEmpty(cell))) return;
    const id = isEmpty(cells.record_id)
      ? null
      : String(cells.record_id).trim().toLowerCase();
    rows.push({ index, cells, id });
  });
  return rows;
}

/**
 * updateCells requests for the rows to write: consecutive rows and consecutive columns are
 * grouped; columns the user inserted between ours are never touched.
 */
export function cellRequests(
  layout: TabLayout,
  rows: { index: number; cells: RowCells }[],
): SheetsRequest[] {
  if (rows.length === 0) return [];
  const columns = [...layout.columns.entries()]
    .filter(([key]) => rows.some((row) => key in row.cells))
    .sort((a, b) => a[1] - b[1]);
  const columnRuns: [string, number][][] = [];
  for (const column of columns) {
    const run = columnRuns.at(-1);
    const last = run?.at(-1);
    if (run && last && column[1] === last[1] + 1) run.push(column);
    else columnRuns.push([column]);
  }
  const sorted = [...rows].sort((a, b) => a.index - b.index);
  const rowRuns: (typeof rows)[] = [];
  for (const row of sorted) {
    const run = rowRuns.at(-1);
    const last = run?.at(-1);
    if (run && last && row.index === last.index + 1) run.push(row);
    else rowRuns.push([row]);
  }
  const requests: SheetsRequest[] = [];
  for (const rowRun of rowRuns) {
    for (const columnRun of columnRuns) {
      requests.push({
        updateCells: {
          start: {
            sheetId: layout.sheetId,
            rowIndex: (rowRun[0] as { index: number }).index,
            columnIndex: (columnRun[0] as [string, number])[1],
          },
          fields: 'userEnteredValue',
          rows: rowRun.map((row) => ({
            values: columnRun.map(([key]) => cellData(row.cells[key])),
          })),
        },
      });
    }
  }
  return requests;
}

/** Google failures → the same sanitized codes as the setup; anything else → sync failed. */
function syncFailure(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof GoogleApiError && error.kind !== 'invalid_request') {
    return toApiException(error);
  }
  return new ApiException(
    HttpStatus.BAD_GATEWAY,
    'spreadsheet_sync_failed',
    'Não foi possível sincronizar a planilha. Tente novamente.',
  );
}
