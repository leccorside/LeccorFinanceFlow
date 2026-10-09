import { translate } from '../../i18n/catalog';
import { formatCalendarDate, formatMoney } from '../../i18n/format';
import {
  candidateName,
  describeRecord,
  errorKey,
  itemsFromHistory,
  toolLabel,
} from './chat-model';

const t = (
  key: Parameters<typeof translate>[1],
  params?: Record<string, string | number>,
) => translate('pt-BR', key, params);
const i18n = {
  t,
  money: (amount: string | number, currency?: string) =>
    formatMoney(amount, currency ?? 'BRL', 'pt-BR'),
  calendarDate: (date: string) => formatCalendarDate(date, 'pt-BR'),
};

describe('chat model', () => {
  it('turns stored history into chat items, skipping empty tool-calling replies', () => {
    const base = {
      provider: null,
      toolName: null,
      toolCalls: [],
      toolStatus: null,
      createdAt: '2026-10-09T10:00:00.000Z',
    };
    const items = itemsFromHistory([
      { ...base, id: '1', role: 'USER', content: 'oi' },
      { ...base, id: '2', role: 'ASSISTANT', content: '', toolCalls: ['list_accounts'] },
      {
        ...base,
        id: '3',
        role: 'TOOL',
        content: null,
        toolName: 'list_accounts',
        toolStatus: 'ok',
      },
      { ...base, id: '4', role: 'ASSISTANT', content: 'Você tem 2 contas.' },
      { ...base, id: '5', role: 'SYSTEM', content: 'interno' },
    ]);
    expect(items.map((item) => item.kind)).toEqual(['user', 'tool', 'assistant']);
  });

  it('describes summaries with localized labels, money and calendar dates', () => {
    const rows = describeRecord(i18n, {
      id: 'hidden',
      description: 'Mercado',
      amount: '75.00',
      currency: 'BRL',
      occurredOn: '2026-10-08',
      irreversible: true,
      conversations: { total: 3 },
      empty: null,
    });
    expect(rows.map((row) => [row.label, row.value.replace(/\s/g, ' ')])).toEqual([
      ['Descrição', 'Mercado'],
      ['Valor', 'R$ 75,00'],
      ['Data', '8 de out. de 2026'],
      ['Irreversível', 'Sim'],
      ['Conversas', 'total: 3'],
    ]);
  });

  it('falls back to readable names for tools, fields and errors it does not know', () => {
    expect(toolLabel(t, 'create_transaction')).toBe('Novo lançamento');
    expect(toolLabel(t, 'brand_new_tool')).toBe('brand new tool');
    expect(describeRecord(i18n, { someField: 'x' })[0]?.label).toBe('someField');
    expect(errorKey('rate_limited')).toBe('assistant.error.rate_limited');
    expect(errorKey('anything_else')).toBe('assistant.sendError');
    expect(candidateName({ id: 'abcdef123456' })).toBe('abcdef12');
    expect(candidateName({ id: 'x', name: 'Nubank' })).toBe('Nubank');
  });
});
