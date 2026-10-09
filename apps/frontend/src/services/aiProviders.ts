import { api } from './api';

export type AiProviderType = 'OPENAI' | 'GEMINI' | 'ANTHROPIC';
export type AiPurpose = 'CHAT' | 'FINANCIAL_INTERPRETATION' | 'ANALYSIS';
export const AI_PURPOSES: AiPurpose[] = ['CHAT', 'FINANCIAL_INTERPRETATION', 'ANALYSIS'];

/** A configuration as the API shows it: the key itself never comes back. */
export interface AiConfiguration {
  id: string;
  purpose: AiPurpose;
  model: string;
  priority: number;
  isActive: boolean;
  keySource: 'stored' | 'environment' | 'missing';
  keyVersion: string | null;
  updatedAt: string;
}

export interface AiProvider {
  id: string;
  type: AiProviderType;
  displayName: string;
  isActive: boolean;
  capabilities: AiPurpose[];
  defaultModel: string | null;
  hasEnvironmentKey: boolean;
  configurations: AiConfiguration[];
}

export interface ProbeResult {
  ok: boolean;
  provider: AiProviderType;
  model: string;
  latencyMs: number;
  error: string | null;
}

export async function listAiProviders(): Promise<AiProvider[]> {
  return (await api.get<AiProvider[]>('/admin/ai-providers')).data;
}

export async function setProviderActive(
  id: string,
  isActive: boolean,
): Promise<AiProvider> {
  return (await api.patch<AiProvider>(`/admin/ai-providers/${id}`, { isActive })).data;
}

export async function createAiConfiguration(
  providerId: string,
  input: { purpose: AiPurpose; model: string; priority?: number; apiKey?: string },
): Promise<AiProvider> {
  return (
    await api.post<AiProvider>(`/admin/ai-providers/${providerId}/configurations`, input)
  ).data;
}

export async function updateAiConfiguration(
  id: string,
  input: { model?: string; isActive?: boolean; apiKey?: string | null },
): Promise<AiProvider> {
  return (await api.patch<AiProvider>(`/admin/ai-configurations/${id}`, input)).data;
}

export async function deleteAiConfiguration(id: string): Promise<void> {
  await api.delete(`/admin/ai-configurations/${id}`);
}

export async function reorderAiConfigurations(
  purpose: AiPurpose,
  configurationIds: string[],
): Promise<AiProvider[]> {
  return (
    await api.post<AiProvider[]>('/admin/ai-configurations/reorder', {
      purpose,
      configurationIds,
    })
  ).data;
}

export async function testAiConfiguration(id: string): Promise<ProbeResult> {
  return (await api.post<ProbeResult>(`/admin/ai-configurations/${id}/test`)).data;
}
