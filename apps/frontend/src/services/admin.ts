import { api } from './api';

export type UsageKind = 'AI_CHAT' | 'VOICE_TRANSCRIPTION' | 'VOICE_SPEECH';

export interface UsageRow {
  kind: UsageKind;
  provider: string;
  model: string;
  requests: number;
  failures: number;
  inputUnits: number;
  outputUnits: number;
  estimatedCostUsd: string | null;
}

export interface VoiceChainStatus {
  enabled: boolean;
  providers: { provider: string; keyConfigured: boolean; model: string | null }[];
}

export interface AdminOverview {
  windowDays: number;
  users: {
    total: number;
    active: number;
    blocked: number;
    admins: number;
    newInWindow: number;
  };
  google: { connected: number; needsReauth: number; revoked: number };
  spreadsheets: { active: number; total: number };
  assistant: { conversations: number; messagesInWindow: number; enabled: boolean };
  reports: { generatedInWindow: number };
  ai: { activeProviders: number; activeConfigurations: number };
  usage: { rows: UsageRow[]; estimatedCostUsd: string; unpriced: number };
  voice: { transcription: VoiceChainStatus; speech: VoiceChainStatus };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  status: 'ACTIVE' | 'BLOCKED';
  roles: ('ADMIN' | 'USER')[];
  adminFromEnvironment: boolean;
  isSelf: boolean;
  googleConnection: 'ACTIVE' | 'NEEDS_REAUTH' | 'REVOKED' | null;
  spreadsheets: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserQuery {
  q?: string | undefined;
  status?: 'ACTIVE' | 'BLOCKED' | undefined;
  role?: 'ADMIN' | 'USER' | undefined;
  page: number;
  pageSize: number;
}

export interface PriceEntry {
  kind: UsageKind;
  provider: string;
  model: string;
  input: string;
  output: string;
}

export interface SettingValues {
  'signups.enabled': boolean;
  'assistant.enabled': boolean;
  'voice.transcription.enabled': boolean;
  'voice.speech.enabled': boolean;
  'usage.prices': PriceEntry[];
}

export interface SettingsView {
  values: SettingValues;
  definitions: { key: keyof SettingValues; description: string; default: unknown }[];
}

export async function getOverview(): Promise<AdminOverview> {
  return (await api.get<AdminOverview>('/admin/overview')).data;
}

export async function listUsers(
  query: UserQuery,
): Promise<{ items: AdminUser[]; total: number }> {
  const params = Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== ''),
  );
  return (
    await api.get<{ items: AdminUser[]; total: number }>('/admin/users', { params })
  ).data;
}

export async function setUserStatus(
  id: string,
  status: AdminUser['status'],
): Promise<AdminUser> {
  return (await api.patch<AdminUser>(`/admin/users/${id}/status`, { status })).data;
}

export async function setUserAdmin(id: string, admin: boolean): Promise<AdminUser> {
  return (await api.patch<AdminUser>(`/admin/users/${id}/admin`, { admin })).data;
}

export async function getSettings(): Promise<SettingsView> {
  return (await api.get<SettingsView>('/admin/settings')).data;
}

export async function updateSettings(
  changes: Partial<SettingValues>,
): Promise<SettingsView> {
  return (await api.patch<SettingsView>('/admin/settings', changes)).data;
}
