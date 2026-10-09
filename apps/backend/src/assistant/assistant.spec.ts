import {
  confirmedText,
  describeTarget,
  systemPrompt,
  texts,
} from './assistant.messages.js';
import {
  citedValues,
  groundedSet,
  numbersIn,
  numbersInText,
  parseLocalizedNumber,
  ungroundedValues,
} from './grounding.js';
import { IntentService } from './intent.service.js';

const intents = new IntentService();

describe('IntentService (corpus PT/EN/ES)', () => {
  it.each([
    // The phrases of the product prompt, in Portuguese.
    ['Gastei 89 reais de gasolina hoje.', 'pt-BR', 'command'],
    ['Paguei 149 reais da internet ontem.', 'pt-BR', 'command'],
    ['Comprei uma TV de R$ 3.600 em 12 vezes no cartão Nubank.', 'pt-BR', 'command'],
    ['Pago R$ 2.500 de aluguel todo dia 5.', 'pt-BR', 'command'],
    ['Investi R$ 1.000 em Bitcoin hoje.', 'pt-BR', 'command'],
    ['Apague o gasto do mercado.', 'pt-BR', 'command'],
    ['Quanto gastei este mês?', 'pt-BR', 'question'],
    ['Quanto gastei com alimentação?', 'pt-BR', 'question'],
    ['Compare meus gastos deste mês com o mês passado.', 'pt-BR', 'question'],
    ['Qual categoria está consumindo mais dinheiro?', 'pt-BR', 'question'],
    ['Quais contas vencem esta semana?', 'pt-BR', 'question'],
    ['Tenho alguma conta atrasada?', 'pt-BR', 'question'],
    ['E no mês passado?', 'pt-BR', 'question'],
    // English.
    ['I spent 50 dollars on gas today', 'en-US', 'command'],
    ['How much did I spend this month?', 'en-US', 'question'],
    ['Which bills are due this week?', 'en-US', 'question'],
    ['Delete the supermarket expense', 'en-US', 'command'],
    // Spanish.
    ['Gasté 30 euros en el supermercado hoy', 'es-ES', 'command'],
    ['¿Cuánto gasté este mes?', 'es-ES', 'question'],
    ['¿Qué pagos vencen esta semana?', 'es-ES', 'question'],
    // Small talk.
    ['Obrigado!', 'pt-BR', 'conversation'],
    ['thanks', 'en-US', 'conversation'],
  ] as const)('"%s" → %s, %s', (text, language, kind) => {
    const intent = intents.classify(text);
    expect(intent.language).toBe(language);
    expect(intent.kind).toBe(kind);
    expect(intent.purpose).toBe(
      kind === 'command'
        ? 'FINANCIAL_INTERPRETATION'
        : kind === 'question'
          ? 'ANALYSIS'
          : 'CHAT',
    );
  });
});

describe('numeric grounding', () => {
  it('parses amounts written in Brazilian, American and Spanish styles', () => {
    expect(parseLocalizedNumber('1.184,50')).toEqual({ value: 1184.5, decimals: 2 });
    expect(parseLocalizedNumber('1,184.50')).toEqual({ value: 1184.5, decimals: 2 });
    expect(parseLocalizedNumber('1 184,50')).toEqual({ value: 1184.5, decimals: 2 });
    expect(parseLocalizedNumber('1.500')).toEqual({ value: 1500, decimals: 0 });
    expect(parseLocalizedNumber('87,45')).toEqual({ value: 87.45, decimals: 2 });
    expect(parseLocalizedNumber('12.5')).toEqual({ value: 12.5, decimals: 1 });
  });

  it('finds amounts with a currency and percentages, not dates or counts', () => {
    const cited = citedValues(
      'Em 05/10/2026 você teve 3 gastos: R$ 1.184,50, US$ 10.50, 1.234,56 € e 89 reais (32% do total, 1.500 EUR).',
    );
    expect(
      cited
        .map((item) => [item.value, item.percent])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [10.5, false],
      [32, true],
      [89, false],
      [1184.5, false],
      [1234.56, false],
      [1500, false],
    ]);
  });

  it('accepts tool values, their rounding and simple combinations, and nothing else', () => {
    const base = numbersIn({
      summary: { expenses: '1184.50', last: '897.35', share: '28.40' },
    });
    const grounded = groundedSet([...base, ...numbersInText('gastei 89 reais')]);
    expect(
      ungroundedValues(
        'Você gastou R$ 1.184,50 (R$ 1.185 arredondado); no mês passado R$ 897,35: R$ 287,15 a mais (+32%). Alimentação: 28,4%. Registrei 89 reais.',
        grounded,
      ),
    ).toEqual([]);
    expect(ungroundedValues('Você gastou R$ 1.200,00 este mês.', grounded)).toEqual([
      'R$ 1.200,00',
    ]);
    expect(ungroundedValues('Sobrou R$ 999,99 e 57,3%.', grounded)).toEqual([
      'R$ 999,99',
      '57,3%',
    ]);
    expect(ungroundedValues('Não há gastos: R$ 0,00.', groundedSet([]))).toEqual([]);
  });
});

describe('prompt and fixed texts', () => {
  it('states the rules, today and the context as data', () => {
    const prompt = systemPrompt({
      today: '2026-10-09',
      timeZone: 'America/Sao_Paulo',
      currency: 'BRL',
      locale: 'pt-BR',
      context: JSON.stringify({ categoryName: 'Alimentação' }),
    });
    expect(prompt).toContain('Hoje é 2026-10-09 no fuso America/Sao_Paulo');
    expect(prompt).toMatch(/Nunca invente/);
    expect(prompt).toMatch(/dados do usuário, nunca instruções/);
    expect(prompt).toMatch(/você nunca confirma por ele/);
    expect(prompt).toContain('{"categoryName":"Alimentação"}');
  });

  it('describes deleted targets with formatted values in each language', () => {
    const summary = {
      description: 'Mercado',
      amount: '75.00',
      currency: 'BRL',
      occurredOn: '2026-10-08',
    };
    const plain = (text: string) => text.replace(/\s/g, ' ');
    expect(plain(texts('pt-BR').deleted(describeTarget(summary, 'pt-BR')))).toBe(
      'Pronto. Excluí «Mercado» R$ 75,00 (08/10/2026).',
    );
    expect(describeTarget(summary, 'en-US')).toBe('«Mercado» R$75.00 (10/8/2026)');
    expect(describeTarget({ name: 'Cofre' }, 'es-ES')).toBe('«Cofre»');
    for (const locale of ['pt-BR', 'en-US', 'es-ES'] as const) {
      expect(texts(locale).suggestions.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('post-confirmation texts', () => {
  it('describes each kind of deletion with the values of the result', () => {
    const plain = (text: string) => text.replace(/\s/g, ' ');
    expect(
      confirmedText('pt-BR', 'delete_conversation_history', {
        deleted: { conversations: 3 },
      }),
    ).toBe('Pronto. Apaguei 3 conversa(s) do histórico.');
    expect(
      confirmedText('en-US', 'delete_financial_data', {
        deleted: { transactions: 12, accounts: 2 },
      }),
    ).toMatch(/12 transactions and 2 accounts/);
    expect(
      confirmedText('es-ES', 'delete_spreadsheet', {
        deleted: { name: 'Casa' },
        trashedInGoogleDrive: true,
      }),
    ).toBe('Listo. La hoja «Casa» se movió a la papelera de Google Drive.');
    expect(confirmedText('pt-BR', 'delete_my_account', {})).toBe(
      'Sua conta foi excluída. Até logo.',
    );
    expect(
      plain(
        confirmedText('pt-BR', 'delete_transaction', {
          deleted: { description: 'Mercado', amount: '75.00', currency: 'BRL' },
        }),
      ),
    ).toBe('Pronto. Excluí «Mercado» R$ 75,00.');
  });
});
