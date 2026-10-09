import { isMessageKey, type MessageKey } from '../../i18n/catalog';
import type { I18nValue } from '../../i18n/context';
import type {
  AssistantTurn,
  StoredMessage,
  ToolStatus,
  TurnAction,
  TurnAttachment,
} from '../../services/assistant';

/** What the chat shows; history and live turns become the same shape. */
export type ChatItem =
  | { kind: 'user'; id: string; content: string; createdAt: string }
  | {
      kind: 'assistant';
      id: string;
      content: string;
      createdAt: string;
      failed?: boolean;
      actions?: TurnAction[];
      candidates?: Record<string, unknown>[];
      attachments?: TurnAttachment[];
    }
  | {
      kind: 'tool';
      id: string;
      tool: string;
      status: ToolStatus | null;
      createdAt: string;
    }
  | {
      kind: 'notice';
      id: string;
      content: string;
      tone: 'info' | 'error';
      createdAt: string;
    };

export function itemsFromHistory(rows: StoredMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const row of rows) {
    if (row.role === 'USER' && row.content) {
      items.push({
        kind: 'user',
        id: row.id,
        content: row.content,
        createdAt: row.createdAt,
      });
    } else if (row.role === 'ASSISTANT' && row.content?.trim()) {
      items.push({
        kind: 'assistant',
        id: row.id,
        content: row.content,
        createdAt: row.createdAt,
      });
    } else if (row.role === 'TOOL' && row.toolName) {
      items.push({
        kind: 'tool',
        id: row.id,
        tool: row.toolName,
        status: row.toolStatus,
        createdAt: row.createdAt,
      });
    }
  }
  return items;
}

export function itemFromTurn(turn: AssistantTurn): ChatItem {
  return {
    kind: 'assistant',
    // A reply that could not be stored (conversation deleted meanwhile) has no id.
    id: turn.reply.id || `reply-${turn.reply.createdAt}`,
    content: turn.reply.content,
    createdAt: turn.reply.createdAt,
    failed: turn.state === 'error',
    actions: turn.actions,
    candidates: turn.candidates,
    attachments: turn.attachments ?? [],
  };
}

/** Translates a key built from API data, falling back to a readable form of the raw name. */
export function label(t: I18nValue['t'], prefix: string, name: string): string {
  const key = `${prefix}.${name}`;
  if (isMessageKey(key)) return t(key);
  return name.replace(/_/g, ' ');
}

export function toolLabel(t: I18nValue['t'], tool: string): string {
  return label(t, 'assistant.tool', tool);
}

const MONEY_FIELDS = new Set(['amount', 'totalAmount', 'balance', 'invested']);
const DATE_FIELDS = new Set(['occurredOn', 'dueOn', 'startsOn']);
const HIDDEN_FIELDS = new Set(['id', 'currency', 'state', 'version', 'updatedAt']);

/**
 * Human rows for a confirmation summary or a candidate ("Valor: R$ 75,00"). Only plain
 * values are shown; nested counts become "name: n" lines.
 */
export function describeRecord(
  i18n: Pick<I18nValue, 't' | 'money' | 'calendarDate'>,
  record: Record<string, unknown>,
): { key: string; label: string; value: string }[] {
  const { t, money, calendarDate } = i18n;
  const currency = typeof record.currency === 'string' ? record.currency : undefined;
  const rows: { key: string; label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(record)) {
    if (HIDDEN_FIELDS.has(key) || raw === null || raw === undefined || raw === '')
      continue;
    let value: string;
    if (MONEY_FIELDS.has(key) && (typeof raw === 'string' || typeof raw === 'number')) {
      value = money(raw, currency);
    } else if (DATE_FIELDS.has(key) && typeof raw === 'string') {
      value = calendarDate(raw.slice(0, 10));
    } else if (typeof raw === 'boolean') {
      value = t(raw ? 'assistant.confirm.yesNo' : 'assistant.confirm.noValue');
    } else if (typeof raw === 'string' || typeof raw === 'number') {
      value = String(raw);
    } else if (typeof raw === 'object' && !Array.isArray(raw)) {
      value = Object.entries(raw as Record<string, unknown>)
        .filter(([, nested]) => typeof nested === 'number' || typeof nested === 'string')
        .map(
          ([name, nested]) => `${label(t, 'assistant.field', name)}: ${String(nested)}`,
        )
        .join(' · ');
      if (!value) continue;
    } else {
      continue;
    }
    rows.push({ key, label: label(t, 'assistant.field', key), value });
  }
  return rows;
}

/** A short name for a candidate card and for the message that picks it. */
export function candidateName(record: Record<string, unknown>): string {
  for (const key of ['description', 'name', 'title', 'email']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return typeof record.id === 'string' ? record.id.slice(0, 8) : '?';
}

export function errorKey(code: string | undefined): MessageKey {
  const key = `assistant.error.${code ?? ''}`;
  return isMessageKey(key) ? key : 'assistant.sendError';
}
