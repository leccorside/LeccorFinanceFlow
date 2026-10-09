import { api } from './api';

export type TurnState =
  'answered' | 'needs_confirmation' | 'needs_clarification' | 'error';
export type ToolStatus =
  'ok' | 'confirmation_required' | 'ambiguous' | 'rejected' | 'error';
export type SyncState = 'SYNCED' | 'PENDING_SYNC' | 'CONFLICT' | 'NO_SPREADSHEET';

export interface TurnAction {
  tool: string;
  status: ToolStatus;
  error?: string;
  sync?: SyncState;
}

export interface TurnConfirmation {
  id: string;
  tool: string;
  summary: Record<string, unknown>;
  expiresAt: string;
}

/** One answer of the assistant (POST /assistant/messages and in-conversation confirmations). */
export interface AssistantTurn {
  conversationId: string;
  state: TurnState;
  reply: { id: string; content: string; provider: string | null; createdAt: string };
  actions: TurnAction[];
  confirmations: TurnConfirmation[];
  candidates: Record<string, unknown>[];
  suggestions: string[];
  error?: { code: string };
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'TOOL' | 'SYSTEM';
  content: string | null;
  provider: string | null;
  toolName: string | null;
  toolCalls: string[];
  toolStatus: ToolStatus | null;
  createdAt: string;
}

export interface PendingConfirmation extends TurnConfirmation {
  conversationId: string | null;
  createdAt: string;
}

/** Same structure the model sees; the UI only reads what it needs. */
export type ToolOutcome =
  | { status: 'ok'; tool: string; data: unknown; sync?: SyncState }
  | {
      status: 'confirmation_required';
      tool: string;
      confirmation: { id: string; expiresAt: string; summary: Record<string, unknown> };
    }
  | { status: 'ambiguous'; tool: string; candidates: Record<string, unknown>[] }
  | { status: 'rejected' | 'error'; tool: string; error: string; message?: string };

export async function sendMessage(body: {
  message: string;
  conversationId?: string;
}): Promise<AssistantTurn> {
  return (await api.post<AssistantTurn>('/assistant/messages', body)).data;
}

export async function getSuggestions(): Promise<string[]> {
  return (await api.get<string[]>('/assistant/suggestions')).data;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return (await api.get<ConversationSummary[]>('/assistant/conversations')).data;
}

export async function getMessages(conversationId: string): Promise<StoredMessage[]> {
  return (
    await api.get<StoredMessage[]>(`/assistant/conversations/${conversationId}/messages`)
  ).data;
}

export async function listPendingConfirmations(): Promise<PendingConfirmation[]> {
  return (await api.get<PendingConfirmation[]>('/assistant/confirmations')).data;
}

export async function confirmInConversation(
  conversationId: string,
  confirmationId: string,
): Promise<AssistantTurn> {
  return (
    await api.post<AssistantTurn>(
      `/assistant/conversations/${conversationId}/confirmations/${confirmationId}/confirm`,
    )
  ).data;
}

export async function cancelInConversation(
  conversationId: string,
  confirmationId: string,
): Promise<AssistantTurn> {
  return (
    await api.post<AssistantTurn>(
      `/assistant/conversations/${conversationId}/confirmations/${confirmationId}/cancel`,
    )
  ).data;
}

export async function undoLastAction(): Promise<ToolOutcome> {
  return (await api.post<ToolOutcome>('/assistant/undo')).data;
}
