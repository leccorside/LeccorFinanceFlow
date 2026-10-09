import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { apiKeyContext } from '../ai/ai.service.js';
import { ApiException, ResourceNotFoundException } from '../common/errors/api-error.js';
import {
  CREDENTIAL_VAULT,
  type CredentialVault,
} from '../common/crypto/credential-vault.js';
import { defined } from '../common/validation/defined.js';
import { dto } from '../common/validation/zod-validation.pipe.js';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  type AIConfiguration,
  type AIProvider,
  type AIPurpose,
  Prisma,
} from '../generated/prisma/client.js';

export const AI_PURPOSES = ['CHAT', 'FINANCIAL_INTERPRETATION', 'ANALYSIS'] as const;

/** Printable ASCII without spaces: every provider key format fits. */
const apiKey = z
  .string()
  .trim()
  .min(8)
  .max(500)
  .regex(/^[\x21-\x7e]+$/, 'must be printable characters without spaces');
const model = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:/-]{1,100}$/, 'letters, digits and . _ : / -');
const priority = z.number().int().min(1).max(100);

export const updateProviderSchema = dto({
  isActive: z.boolean(),
  displayName: z.string().trim().min(1).max(100),
})
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

export const createConfigurationSchema = dto({
  purpose: z.enum(AI_PURPOSES),
  model,
  priority: priority.optional(),
  isActive: z.boolean().optional(),
  /** Write-only: encrypted at rest and never returned. */
  apiKey: apiKey.optional(),
});

export const updateConfigurationSchema = dto({
  model,
  priority,
  isActive: z.boolean(),
  /** A new key replaces the stored one; null removes it (environment key, if any). */
  apiKey: apiKey.nullable(),
})
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

export const reorderSchema = dto({
  purpose: z.enum(AI_PURPOSES),
  configurationIds: z.array(z.uuid()).min(1).max(30),
});

export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
export type CreateConfigurationInput = z.infer<typeof createConfigurationSchema>;
export type UpdateConfigurationInput = z.infer<typeof updateConfigurationSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;

export interface ConfigurationView {
  id: string;
  purpose: AIPurpose;
  model: string;
  priority: number;
  isActive: boolean;
  /** Where the key comes from; the key itself is never exposed, not even masked. */
  keySource: 'stored' | 'environment' | 'missing';
  keyVersion: string | null;
  updatedAt: string;
}

export interface ProviderView {
  id: string;
  type: AIProvider['type'];
  displayName: string;
  isActive: boolean;
  capabilities: AIPurpose[];
  /** Suggested model from the server environment, if any. */
  defaultModel: string | null;
  hasEnvironmentKey: boolean;
  configurations: ConfigurationView[];
}

/** Administration of AI providers, models, priorities and keys (ADMIN only). */
@Injectable()
export class AiProvidersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CREDENTIAL_VAULT) private readonly vault: CredentialVault | null,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async list(): Promise<ProviderView[]> {
    const providers = await this.prisma.aIProvider.findMany({
      include: { configurations: { orderBy: [{ purpose: 'asc' }, { priority: 'asc' }] } },
      orderBy: { type: 'asc' },
    });
    return providers.map((provider) => this.view(provider));
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<ProviderView> {
    await this.findProvider(id);
    await this.prisma.aIProvider.update({ where: { id }, data: defined(input) });
    return this.viewOf(id);
  }

  async createConfiguration(
    providerId: string,
    input: CreateConfigurationInput,
  ): Promise<ProviderView> {
    const provider = await this.findProvider(providerId);
    if (!provider.capabilities.includes(input.purpose)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ai_purpose_not_supported',
        'Esse provedor não atende a essa finalidade.',
      );
    }
    if (
      await this.prisma.aIConfiguration.count({
        where: { providerId, purpose: input.purpose },
      })
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'ai_configuration_exists',
        'Esse provedor já tem uma configuração para essa finalidade.',
      );
    }
    const next =
      input.priority ??
      ((
        await this.prisma.aIConfiguration.aggregate({
          where: { purpose: input.purpose },
          _max: { priority: true },
        })
      )._max.priority ?? 0) + 1;
    await this.ensurePriorityFree(input.purpose, next, null);
    const vault = input.apiKey ? this.requireVault() : null;

    await this.conflictSafe(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.aIConfiguration.create({
          data: {
            providerId,
            purpose: input.purpose,
            model: input.model,
            priority: next,
            isActive: input.isActive ?? true,
          },
        });
        if (vault && input.apiKey) {
          // The key is bound to this configuration's id (AAD), so it needs the id first.
          const sealed = vault.encrypt(input.apiKey, apiKeyContext(created.id));
          await tx.aIConfiguration.update({
            where: { id: created.id },
            data: {
              apiKeyEncrypted: sealed.ciphertext,
              encryptionKeyVersion: sealed.keyVersion,
            },
          });
        }
      }),
    );
    return this.viewOf(providerId);
  }

  async updateConfiguration(
    id: string,
    input: UpdateConfigurationInput,
  ): Promise<ProviderView> {
    const current = await this.findConfiguration(id);
    if (input.priority !== undefined && input.priority !== current.priority) {
      await this.ensurePriorityFree(current.purpose, input.priority, id);
    }
    const data: Prisma.AIConfigurationUpdateInput = {
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    if (input.apiKey === null) {
      data.apiKeyEncrypted = null;
      data.encryptionKeyVersion = null;
    } else if (input.apiKey !== undefined) {
      const sealed = this.requireVault().encrypt(input.apiKey, apiKeyContext(id));
      data.apiKeyEncrypted = sealed.ciphertext;
      data.encryptionKeyVersion = sealed.keyVersion;
    }
    await this.conflictSafe(() =>
      this.prisma.aIConfiguration.update({ where: { id }, data }),
    );
    return this.viewOf(current.providerId);
  }

  async deleteConfiguration(id: string): Promise<void> {
    await this.findConfiguration(id);
    await this.prisma.aIConfiguration.delete({ where: { id } });
  }

  /** Sets the fallback order of a purpose: the listed ids become priorities 1, 2, 3… */
  async reorder(input: ReorderInput): Promise<ProviderView[]> {
    const current = await this.prisma.aIConfiguration.findMany({
      where: { purpose: input.purpose },
      select: { id: true },
    });
    const wanted = new Set(input.configurationIds);
    if (
      wanted.size !== input.configurationIds.length ||
      wanted.size !== current.length ||
      current.some((row) => !wanted.has(row.id))
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ai_reorder_mismatch',
        'Informe todas as configurações dessa finalidade, cada uma uma vez.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      // Two phases: (purpose, priority) is unique at every statement.
      for (const [index, id] of input.configurationIds.entries()) {
        await tx.aIConfiguration.update({
          where: { id },
          data: { priority: 1000 + index },
        });
      }
      for (const [index, id] of input.configurationIds.entries()) {
        await tx.aIConfiguration.update({ where: { id }, data: { priority: index + 1 } });
      }
    });
    return this.list();
  }

  private async viewOf(providerId: string): Promise<ProviderView> {
    const provider = await this.prisma.aIProvider.findUniqueOrThrow({
      where: { id: providerId },
      include: { configurations: { orderBy: [{ purpose: 'asc' }, { priority: 'asc' }] } },
    });
    return this.view(provider);
  }

  private view(
    provider: AIProvider & { configurations: AIConfiguration[] },
  ): ProviderView {
    const environmentKey = this.env.AI.environmentKeys[provider.type] !== undefined;
    return {
      id: provider.id,
      type: provider.type,
      displayName: provider.displayName,
      isActive: provider.isActive,
      capabilities: provider.capabilities,
      defaultModel: this.env.AI.defaultModels[provider.type] ?? null,
      hasEnvironmentKey: environmentKey,
      // Explicit allowlist of fields: the ciphertext never reaches a response.
      configurations: provider.configurations.map((configuration) => ({
        id: configuration.id,
        purpose: configuration.purpose,
        model: configuration.model,
        priority: configuration.priority,
        isActive: configuration.isActive,
        keySource: configuration.apiKeyEncrypted
          ? 'stored'
          : environmentKey
            ? 'environment'
            : 'missing',
        keyVersion: configuration.encryptionKeyVersion,
        updatedAt: configuration.updatedAt.toISOString(),
      })),
    };
  }

  private async findProvider(id: string): Promise<AIProvider> {
    const provider = await this.prisma.aIProvider.findUnique({ where: { id } });
    if (!provider) throw new ResourceNotFoundException();
    return provider;
  }

  private async findConfiguration(id: string): Promise<AIConfiguration> {
    const configuration = await this.prisma.aIConfiguration.findUnique({ where: { id } });
    if (!configuration) throw new ResourceNotFoundException();
    return configuration;
  }

  private async ensurePriorityFree(
    purpose: AIPurpose,
    value: number,
    except: string | null,
  ): Promise<void> {
    const taken = await this.prisma.aIConfiguration.count({
      where: { purpose, priority: value, ...(except ? { NOT: { id: except } } : {}) },
    });
    if (taken > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'ai_priority_taken',
        'Já existe uma configuração com essa prioridade nessa finalidade.',
      );
    }
  }

  private requireVault(): CredentialVault {
    if (!this.vault) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'encryption_unavailable',
        'A criptografia de credenciais não está configurada neste ambiente.',
      );
    }
    return this.vault;
  }

  /** A concurrent change can still hit a unique index: answer 409, not 500. */
  private async conflictSafe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'ai_configuration_conflict',
          'A configuração mudou ao mesmo tempo. Recarregue e tente de novo.',
        );
      }
      throw error;
    }
  }
}
