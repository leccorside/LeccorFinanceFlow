import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { endOfMonth, formatCalendarDate, parseCalendarDate } from '../finance/dates.js';
import { ruleViolation } from '../finance/finance.schemas.js';
import type { Report } from '../generated/prisma/client.js';
import { ReportBuilder } from './report-builder.js';
import { renderPdf } from './renderers/pdf.js';
import { renderXlsx } from './renderers/xlsx.js';
import type { ReportFormatName, ReportTypeName } from './report.types.js';

type User = Pick<AuthenticatedUser, 'id' | 'email'>;

export const CONTENT_TYPES: Record<ReportFormatName, string> = {
  PDF: 'application/pdf',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** What the user (or the assistant) asks for; one way of giving the period. */
export interface ReportRequest {
  type: ReportTypeName;
  format: ReportFormatName;
  from?: string | undefined;
  to?: string | undefined;
  /** "2026-09" (whole month). */
  month?: string | undefined;
  /** 2026 (whole year). */
  year?: number | undefined;
}

export interface ReportResponse {
  id: string;
  type: ReportTypeName;
  format: ReportFormatName;
  from: string;
  to: string;
  status: 'GENERATING' | 'READY' | 'FAILED' | 'EXPIRED';
  fileName: string | null;
  expiresAt: string;
  createdAt: string;
  /** Same-origin, session-protected route; only the owner can use it. */
  downloadUrl: string | null;
}

/** Resolves and checks the period of a request, per report type. */
export function resolveReportPeriod(
  request: ReportRequest,
  maxMonths: number,
): { from: Date; to: Date } {
  let from: Date | null;
  let to: Date | null;
  if (request.month) {
    from = parseCalendarDate(`${request.month}-01`);
    to = from ? endOfMonth(from) : null;
  } else if (request.year !== undefined) {
    from = parseCalendarDate(`${request.year}-01-01`);
    to = parseCalendarDate(`${request.year}-12-31`);
  } else {
    from = request.from ? parseCalendarDate(request.from) : null;
    to = request.to ? parseCalendarDate(request.to) : null;
  }
  if (!from || !to || from > to) {
    throw ruleViolation(
      'report_period_invalid',
      'Informe um período válido para o relatório.',
    );
  }
  if (request.type === 'MONTHLY') {
    const wholeMonth =
      from.getUTCDate() === 1 &&
      formatCalendarDate(to) === formatCalendarDate(endOfMonth(from));
    if (!wholeMonth) {
      throw ruleViolation(
        'report_period_invalid',
        'O relatório mensal cobre um mês inteiro (do dia 1º ao último dia).',
      );
    }
  }
  if (request.type === 'ANNUAL') {
    const year = from.getUTCFullYear();
    if (
      formatCalendarDate(from) !== `${year}-01-01` ||
      formatCalendarDate(to) !== `${year}-12-31`
    ) {
      throw ruleViolation(
        'report_period_invalid',
        'O relatório anual cobre um ano inteiro (1º de janeiro a 31 de dezembro).',
      );
    }
  }
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth()) +
    1;
  if (months > maxMonths) {
    throw ruleViolation(
      'report_period_too_long',
      `O período do relatório passa de ${maxMonths} meses. Escolha um período menor.`,
      { maxMonths },
    );
  }
  return { from, to };
}

function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Synchronous report generation. Files are written under REPORT_TEMP_DIRECTORY/<owner>/,
 * readable only by the server, served only to their owner, and deleted when they expire
 * (TTL). Large periods are refused up front instead of producing huge files.
 */
@Injectable()
export class ReportsService implements OnModuleInit {
  private readonly root: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(ReportBuilder) private readonly builder: ReportBuilder,
  ) {
    this.root = resolve(env.REPORT_TEMP_DIRECTORY);
  }

  async onModuleInit(): Promise<void> {
    await this.sweep().catch(() => undefined);
  }

  async create(user: User, request: ReportRequest): Promise<ReportResponse> {
    const { from, to } = resolveReportPeriod(request, this.env.MAX_REPORT_RANGE_MONTHS);
    await this.sweep();
    const movements = await this.builder.countMovements(user, from, to);
    if (movements > this.env.MAX_REPORT_TRANSACTIONS) {
      throw ruleViolation(
        'report_too_large',
        `O período tem ${movements} lançamentos, acima do limite de ${this.env.MAX_REPORT_TRANSACTIONS} por relatório. Escolha um período menor.`,
        { movements, limit: this.env.MAX_REPORT_TRANSACTIONS },
      );
    }

    const row = await this.prisma.report.create({
      data: {
        ownerId: user.id,
        type: request.type,
        format: request.format,
        periodStart: from,
        periodEnd: to,
        status: 'GENERATING',
        expiresAt: this.expiry(),
      },
    });
    const extension = request.format === 'PDF' ? 'pdf' : 'xlsx';
    const storageKey = `${user.id}/${row.id}.${extension}`;
    const path = this.pathOf(storageKey);
    try {
      const document = await this.builder.build(user, request.type, from, to);
      const file =
        request.format === 'PDF' ? await renderPdf(document) : renderXlsx(document);
      await mkdir(join(this.root, user.id), { recursive: true, mode: 0o700 });
      await writeFile(path, file, { mode: 0o600 });
      const fileName = `${slug(document.title)}_${formatCalendarDate(from)}_${formatCalendarDate(to)}.${extension}`;
      const ready = await this.prisma.report.update({
        where: { id: row.id },
        // The TTL counts from when the file exists.
        data: { status: 'READY', fileName, storageKey, expiresAt: this.expiry() },
      });
      return toResponse(ready);
    } catch (error) {
      await rm(path, { force: true }).catch(() => undefined);
      await this.prisma.report.update({
        where: { id: row.id },
        data: { status: 'FAILED', errorMessage: 'generation_failed' },
      });
      if (error instanceof ApiException) throw error;
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'report_failed',
        'Não foi possível gerar o relatório. Tente de novo.',
      );
    }
  }

  async list(user: User): Promise<ReportResponse[]> {
    await this.sweep();
    const rows = await this.prisma.report.findMany({
      where: ownedBy(user),
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map(toResponse);
  }

  async download(
    user: User,
    id: string,
  ): Promise<{ file: Buffer; fileName: string; contentType: string }> {
    const row = await this.prisma.report.findFirst({ where: { id, ...ownedBy(user) } });
    if (!row) throw new ResourceNotFoundException();
    if (
      row.status === 'EXPIRED' ||
      (row.status === 'READY' && row.expiresAt <= new Date())
    ) {
      await this.expire(row);
      throw expired();
    }
    if (row.status !== 'READY' || !row.storageKey || !row.fileName) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'report_not_ready',
        'Este relatório não está disponível.',
      );
    }
    let file: Buffer;
    try {
      file = await readFile(this.pathOf(row.storageKey));
    } catch {
      // The temporary file is gone (e.g. the server's temp storage was cleaned).
      await this.expire(row);
      throw expired();
    }
    return { file, fileName: row.fileName, contentType: CONTENT_TYPES[row.format] };
  }

  /**
   * Removes every report of a user: rows and the whole private folder. Used when the user
   * deletes their financial data or their account (reports hold financial data).
   */
  async purgeOwner(
    ownerId: string,
  ): Promise<{ reports: number; files: 'removed' | 'failed' }> {
    const { count } = await this.prisma.report.deleteMany({ where: { ownerId } });
    try {
      await rm(this.pathOf(ownerId), { recursive: true, force: true });
      return { reports: count, files: 'removed' };
    } catch {
      return { reports: count, files: 'failed' };
    }
  }

  /** Deletes expired files (any owner) and marks their reports EXPIRED. */
  async sweep(): Promise<number> {
    const rows = await this.prisma.report.findMany({
      where: { status: 'READY', expiresAt: { lte: new Date() } },
      take: 200,
    });
    for (const row of rows) await this.expire(row);
    return rows.length;
  }

  private async expire(row: Report): Promise<void> {
    if (row.storageKey)
      await rm(this.pathOf(row.storageKey), { force: true }).catch(() => undefined);
    await this.prisma.report.updateMany({
      where: { id: row.id, status: { in: ['READY', 'EXPIRED'] } },
      data: { status: 'EXPIRED', storageKey: null },
    });
  }

  private expiry(): Date {
    return new Date(Date.now() + this.env.REPORT_FILE_TTL_MINUTES * 60_000);
  }

  /** Storage keys are generated here; the check still refuses anything outside the root. */
  private pathOf(storageKey: string): string {
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(this.root + sep)) throw new ResourceNotFoundException();
    return path;
  }
}

function expired(): ApiException {
  return new ApiException(
    HttpStatus.GONE,
    'report_expired',
    'O relatório expirou. Gere de novo para baixar.',
  );
}

function toResponse(row: Report): ReportResponse {
  const ready = row.status === 'READY' && row.expiresAt > new Date();
  return {
    id: row.id,
    type: row.type,
    format: row.format,
    from: formatCalendarDate(row.periodStart),
    to: formatCalendarDate(row.periodEnd),
    status: row.status === 'READY' && !ready ? 'EXPIRED' : row.status,
    fileName: row.fileName,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    downloadUrl: ready ? `/api/v1/reports/${row.id}/download` : null,
  };
}
