import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import { ownedBy } from '../common/security/ownership.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Spreadsheet } from '../generated/prisma/client.js';
import { GoogleConnectionService } from '../google/google-connection.service.js';
import { LOCALES, toLocaleTag } from '../profile/profile.schemas.js';
import { ProfileService } from '../profile/profile.service.js';
import {
  GOOGLE_WORKSPACE_CLIENT,
  GoogleApiError,
  type GoogleWorkspaceClient,
} from './google-workspace.client.js';
import { buildSetupPlan } from './spreadsheet-setup.js';
import { TEMPLATE_VERSION, TEXTS } from './spreadsheet-template.js';

/** Drive appProperty linking the Google file to our row (idempotent recovery). */
export const APP_PROPERTY = 'lffSpreadsheetId';
/** A setup claim older than this is considered abandoned (crashed process). */
const CLAIM_TTL_MS = 2 * 60_000;

export interface SpreadsheetResponse {
  id: string;
  name: string;
  status: Spreadsheet['status'];
  isActive: boolean;
  locale: string;
  googleSpreadsheetId: string | null;
  /** Link to open the file in Google Sheets (not a secret). */
  url: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toResponse(row: Spreadsheet): SpreadsheetResponse {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    isActive: row.isActive,
    locale: toLocaleTag(row.locale),
    googleSpreadsheetId: row.googleSpreadsheetId,
    url: row.googleSpreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(row.googleSpreadsheetId)}/edit`
      : null,
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SpreadsheetsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoogleConnectionService) private readonly google: GoogleConnectionService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(GOOGLE_WORKSPACE_CLIENT) private readonly workspace: GoogleWorkspaceClient,
  ) {}

  async list(user: Pick<AuthenticatedUser, 'id'>): Promise<SpreadsheetResponse[]> {
    const rows = await this.prisma.spreadsheet.findMany({
      where: { ...ownedBy(user), status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toResponse);
  }

  async get(
    user: Pick<AuthenticatedUser, 'id'>,
    id: string,
  ): Promise<SpreadsheetResponse> {
    const row = await this.prisma.spreadsheet.findFirst({
      where: { id, ...ownedBy(user) },
    });
    if (!row) throw new ResourceNotFoundException();
    return toResponse(row);
  }

  /**
   * Creates (or finishes/repairs) the user's spreadsheet named `name`. Idempotent: calling it
   * again never creates a second Google file and re-applies the template to the same state.
   */
  async ensure(
    user: Pick<AuthenticatedUser, 'id' | 'email'>,
    name: string | undefined,
  ): Promise<SpreadsheetResponse> {
    const profile = await this.profiles.get(user);
    const displayName = profile.firstName ?? user.email.split('@')[0] ?? user.email;
    const finalName = (name ?? TEXTS[profile.locale].spreadsheetTitle(displayName)).slice(
      0,
      150,
    );

    const row = await this.findOrCreateRow(user.id, finalName, profile.locale);
    await this.claim(row.id);
    // A failed repair of a working spreadsheet keeps it ACTIVE, unless its file is gone.
    let keepActive = row.status === 'ACTIVE';

    try {
      const googleSpreadsheetId = await this.withGoogleToken(user.id, async (token) => {
        const fileId = await this.ensureFile(token, row, finalName);
        let snapshot;
        try {
          snapshot = await this.workspace.getSpreadsheet(token, fileId);
        } catch (error) {
          if (!(error instanceof GoogleApiError && error.kind === 'not_found'))
            throw error;
          // The user deleted the file in Drive: forget it and create a fresh one. Until then the
          // row is not usable (an ACTIVE row must have a file: CHECK constraint).
          keepActive = false;
          await this.prisma.spreadsheet.update({
            where: { id: row.id },
            data: { googleSpreadsheetId: null, status: 'PENDING_CREATION' },
          });
          const recreated = await this.ensureFile(
            token,
            { ...row, googleSpreadsheetId: null },
            finalName,
          );
          snapshot = await this.workspace.getSpreadsheet(token, recreated);
        }

        const plan = buildSetupPlan(snapshot, {
          spreadsheetRowId: row.id,
          locale: toLocaleTag(row.locale),
          timeZone: profile.timeZone,
          currency: profile.currency,
        });
        await this.workspace.batchUpdate(token, snapshot.spreadsheetId, plan.requests);
        return snapshot.spreadsheetId;
      });

      return toResponse(await this.activate(row.id, user.id, googleSpreadsheetId));
    } catch (error) {
      const failure = toApiException(error);
      const code = (failure.getResponse() as { code: string }).code;
      await this.prisma.spreadsheet.update({
        where: { id: row.id },
        data: {
          setupStartedAt: null,
          lastErrorCode: code,
          ...(keepActive ? {} : { status: 'ERROR' as const }),
        },
      });
      throw failure;
    }
  }

  private async findOrCreateRow(
    ownerId: string,
    name: string,
    locale: keyof typeof LOCALES,
  ): Promise<Spreadsheet> {
    const existing = await this.prisma.spreadsheet.findUnique({
      where: { ownerId_name: { ownerId, name } },
    });
    if (existing) {
      if (existing.status === 'ARCHIVED') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'spreadsheet_archived',
          'Já existe uma planilha arquivada com esse nome.',
        );
      }
      return existing;
    }
    try {
      return await this.prisma.spreadsheet.create({
        data: {
          ownerId,
          name,
          locale: LOCALES[locale],
          schemaVersion: TEMPLATE_VERSION,
          status: 'PENDING_CREATION',
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.spreadsheet.findUniqueOrThrow({
          where: { ownerId_name: { ownerId, name } },
        });
      }
      throw error;
    }
  }

  /** Only one setup per row at a time; a stale claim (crash) expires after CLAIM_TTL_MS. */
  private async claim(id: string): Promise<void> {
    const { count } = await this.prisma.spreadsheet.updateMany({
      where: {
        id,
        OR: [
          { setupStartedAt: null },
          { setupStartedAt: { lt: new Date(Date.now() - CLAIM_TTL_MS) } },
        ],
      },
      data: { setupStartedAt: new Date() },
    });
    if (count === 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'spreadsheet_setup_in_progress',
        'A planilha já está sendo preparada. Aguarde alguns instantes.',
      );
    }
  }

  /** Reuses the stored file, then a file tagged with our id (crash recovery), else creates one. */
  private async ensureFile(
    token: string,
    row: Spreadsheet,
    name: string,
  ): Promise<string> {
    if (row.googleSpreadsheetId) return row.googleSpreadsheetId;

    const found = await this.workspace.findSpreadsheetByAppProperty(
      token,
      APP_PROPERTY,
      row.id,
    );
    const fileId =
      found ??
      (await this.workspace.createSpreadsheetFile(token, {
        name,
        appProperties: { [APP_PROPERTY]: row.id },
      }));
    // Persist right away: a later failure must not lead to a second file.
    await this.prisma.spreadsheet.update({
      where: { id: row.id },
      data: { googleSpreadsheetId: fileId },
    });
    return fileId;
  }

  /** Runs `work` with a valid token; on a 401 forces one refresh and retries once. */
  async withGoogleToken<T>(
    userId: string,
    work: (token: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await work(await this.google.getAccessToken(userId));
    } catch (error) {
      if (!(error instanceof GoogleApiError && error.kind === 'unauthorized'))
        throw error;
      await this.google.invalidateAccessToken(userId);
      return work(await this.google.getAccessToken(userId));
    }
  }

  private async activate(
    id: string,
    ownerId: string,
    googleSpreadsheetId: string,
  ): Promise<Spreadsheet> {
    const hasActive = await this.prisma.spreadsheet.count({
      where: { ownerId, isActive: true, NOT: { id } },
    });
    try {
      return await this.prisma.spreadsheet.update({
        where: { id },
        data: {
          googleSpreadsheetId,
          status: 'ACTIVE',
          setupStartedAt: null,
          lastErrorCode: null,
          schemaVersion: TEMPLATE_VERSION,
          // The first ready spreadsheet becomes the active one.
          ...(hasActive === 0 ? { isActive: true } : {}),
        },
      });
    } catch (error) {
      // Lost a race for "active": keep it ready but inactive.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.spreadsheet.update({
          where: { id },
          data: {
            googleSpreadsheetId,
            status: 'ACTIVE',
            setupStartedAt: null,
            lastErrorCode: null,
          },
        });
      }
      throw error;
    }
  }
}

/** Maps any failure to a clear, sanitized API error (no Google payload is exposed). */
export function toApiException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error; // google_not_connected, google_reauth_required, google_unavailable, …
  }
  if (error instanceof GoogleApiError) {
    switch (error.kind) {
      case 'unauthorized':
        return new ApiException(
          HttpStatus.CONFLICT,
          'google_reauth_required',
          'Reconecte sua conta Google para continuar.',
        );
      case 'forbidden':
        return new ApiException(
          HttpStatus.CONFLICT,
          'google_permission_denied',
          'O Google recusou o acesso à planilha. Reconecte a conta e confirme a permissão do Drive.',
        );
      case 'not_found':
        return new ApiException(
          HttpStatus.CONFLICT,
          'spreadsheet_not_found',
          'A planilha não foi encontrada no Google Drive.',
        );
      case 'rate_limited':
      case 'unavailable':
        return new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'google_unavailable',
          'O Google não respondeu. Tente novamente em instantes.',
        );
      default:
        return new ApiException(
          HttpStatus.BAD_GATEWAY,
          'spreadsheet_setup_failed',
          'Não foi possível preparar a planilha. Tente novamente.',
        );
    }
  }
  return new ApiException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'spreadsheet_setup_failed',
    'Não foi possível preparar a planilha. Tente novamente.',
  );
}
