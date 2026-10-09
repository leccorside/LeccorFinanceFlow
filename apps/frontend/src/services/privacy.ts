import { api } from './api';
import type { ToolOutcome } from './assistant';

export type DeletionScope = 'conversations' | 'financial_data' | 'account';

/** Plain link: the browser downloads the JSON with the session cookie (GET, no CSRF). */
export const PRIVACY_EXPORT_URL = '/api/v1/privacy/export';

/** Asks for a deletion; the answer is a confirmation to show, never a deletion. */
export async function requestDeletion(scope: DeletionScope): Promise<ToolOutcome> {
  return (await api.post<ToolOutcome>('/assistant/data-deletions', { scope })).data;
}

export async function confirmDeletion(confirmationId: string): Promise<ToolOutcome> {
  return (
    await api.post<ToolOutcome>(`/assistant/confirmations/${confirmationId}/confirm`)
  ).data;
}

export async function cancelDeletion(confirmationId: string): Promise<ToolOutcome> {
  return (
    await api.post<ToolOutcome>(`/assistant/confirmations/${confirmationId}/cancel`)
  ).data;
}
