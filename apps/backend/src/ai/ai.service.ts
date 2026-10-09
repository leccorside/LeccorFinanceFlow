import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import {
  CREDENTIAL_VAULT,
  CredentialDecryptionError,
  type CredentialVault,
} from '../common/crypto/credential-vault.js';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  AIConfiguration,
  AIPurpose,
  AIProviderType,
  PrismaClient,
} from '../generated/prisma/client.js';
import {
  type AiErrorKind,
  AI_PROVIDER_CLIENTS,
  type AiProviderClients,
  AiProviderError,
  type ChatRequest,
  type ChatResult,
} from './ai.types.js';

/** AAD of an API key: a ciphertext copied to another configuration does not decrypt. */
export const apiKeyContext = (configurationId: string) =>
  `ai_configurations:${configurationId}:api_key`;

export type AttemptOutcome =
  'ok' | AiErrorKind | 'not_configured' | 'credential_unreadable';

export interface AiAttempt {
  provider: AIProviderType;
  model: string;
  outcome: AttemptOutcome;
}

export interface AiChatOutcome {
  result: ChatResult;
  /** The provider that actually answered (kept by the conversation, PASSO 14). */
  provider: AIProviderType;
  model: string;
  configurationId: string;
  attempts: AiAttempt[];
}

export interface ProbeResult {
  ok: boolean;
  provider: AIProviderType;
  model: string;
  latencyMs: number;
  /** Failure class when not ok (never the provider's message). */
  error: AttemptOutcome | null;
}

type ConfigurationRow = AIConfiguration & { provider: { type: AIProviderType } };

/**
 * Routes a request to the configured providers of a purpose, in priority order. Falls back
 * only on recoverable failures (unavailable, timeout, rate limit, key or model refused by
 * that provider, malformed answer). An invalid request or blocked content stops right away:
 * another provider would not make it acceptable. Keys are decrypted only for the call and
 * never leave the backend.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CREDENTIAL_VAULT) private readonly vault: CredentialVault | null,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(AI_PROVIDER_CLIENTS) private readonly clients: AiProviderClients,
  ) {}

  async chat(
    purpose: AIPurpose,
    request: Omit<ChatRequest, 'model'>,
  ): Promise<AiChatOutcome> {
    const configurations = await this.prisma.aIConfiguration.findMany({
      where: { purpose, isActive: true, provider: { isActive: true } },
      include: { provider: { select: { type: true } } },
      orderBy: { priority: 'asc' },
    });
    if (configurations.length === 0) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ai_not_configured',
        'Nenhum provedor de IA está configurado para esta finalidade.',
      );
    }

    const attempts: AiAttempt[] = [];
    for (const configuration of configurations) {
      const attempt = {
        provider: configuration.provider.type,
        model: configuration.model,
      };
      const key = this.keyOf(configuration);
      if (typeof key !== 'string') {
        attempts.push({ ...attempt, outcome: key.missing });
        continue;
      }
      try {
        const result = await this.call(configuration, key, request);
        attempts.push({ ...attempt, outcome: 'ok' });
        return {
          result,
          provider: configuration.provider.type,
          model: configuration.model,
          configurationId: configuration.id,
          attempts,
        };
      } catch (error) {
        if (!(error instanceof AiProviderError)) throw error;
        attempts.push({ ...attempt, outcome: error.kind });
        if (!error.recoverable) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            error.kind === 'content_blocked'
              ? 'ai_content_blocked'
              : 'ai_request_rejected',
            error.kind === 'content_blocked'
              ? 'O provedor de IA recusou o conteúdo da solicitação.'
              : 'O provedor de IA recusou a solicitação como inválida.',
            { attempts },
          );
        }
      }
    }
    throw new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'ai_unavailable',
      'Nenhum provedor de IA respondeu. Tente novamente em instantes.',
      { attempts },
    );
  }

  /** Admin check of one configuration: a tiny request, no fallback. */
  async probe(configurationId: string): Promise<ProbeResult> {
    const configuration = await this.prisma.aIConfiguration.findUnique({
      where: { id: configurationId },
      include: { provider: { select: { type: true } } },
    });
    if (!configuration) throw new ResourceNotFoundException();
    const base = { provider: configuration.provider.type, model: configuration.model };
    const key = this.keyOf(configuration);
    if (typeof key !== 'string') {
      return { ...base, ok: false, latencyMs: 0, error: key.missing };
    }
    const started = Date.now();
    try {
      await this.call(configuration, key, {
        messages: [{ role: 'user', content: 'Responda apenas: ok' }],
        maxOutputTokens: 16,
      });
      return { ...base, ok: true, latencyMs: Date.now() - started, error: null };
    } catch (error) {
      if (!(error instanceof AiProviderError)) throw error;
      return { ...base, ok: false, latencyMs: Date.now() - started, error: error.kind };
    }
  }

  private call(
    configuration: ConfigurationRow,
    apiKey: string,
    request: Omit<ChatRequest, 'model'>,
  ): Promise<ChatResult> {
    const client = this.clients[configuration.provider.type];
    return client.chat(
      apiKey,
      { ...request, model: configuration.model },
      AbortSignal.timeout(this.env.AI.timeoutMs),
    );
  }

  /** Stored key (decrypted now), else the server environment key, else missing. */
  private keyOf(
    configuration: ConfigurationRow,
  ): string | { missing: 'not_configured' | 'credential_unreadable' } {
    if (configuration.apiKeyEncrypted) {
      if (!this.vault) return { missing: 'credential_unreadable' };
      try {
        return this.vault.decrypt(
          configuration.apiKeyEncrypted,
          apiKeyContext(configuration.id),
        );
      } catch (error) {
        if (error instanceof CredentialDecryptionError) {
          return { missing: 'credential_unreadable' };
        }
        throw error;
      }
    }
    return (
      this.env.AI.environmentKeys[configuration.provider.type] ?? {
        missing: 'not_configured',
      }
    );
  }
}

/** Re-encrypts stored AI keys with the active key version (see `credentials:rotate`). */
export async function rotateAiCredentials(
  prisma: Pick<PrismaClient, 'aIConfiguration'>,
  vault: CredentialVault,
): Promise<{ checked: number; rotated: number; failed: number }> {
  const rows = await prisma.aIConfiguration.findMany({
    where: { apiKeyEncrypted: { not: null } },
    select: { id: true, apiKeyEncrypted: true },
  });
  let rotated = 0;
  let failed = 0;
  for (const row of rows) {
    const ciphertext = row.apiKeyEncrypted as string;
    if (vault.isCurrent(ciphertext)) continue;
    try {
      const next = vault.reencrypt(ciphertext, apiKeyContext(row.id));
      // Only if nobody changed the key meanwhile.
      const { count } = await prisma.aIConfiguration.updateMany({
        where: { id: row.id, apiKeyEncrypted: ciphertext },
        data: { apiKeyEncrypted: next.ciphertext, encryptionKeyVersion: next.keyVersion },
      });
      rotated += count;
    } catch (error) {
      if (error instanceof CredentialDecryptionError) {
        failed += 1; // left untouched: recoverable with the old key
        continue;
      }
      throw error;
    }
  }
  return { checked: rows.length, rotated, failed };
}
