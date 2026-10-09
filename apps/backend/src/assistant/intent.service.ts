import { Injectable } from '@nestjs/common';
import type { AIPurpose } from '../generated/prisma/enums.js';
import type { LocaleTag } from '../profile/profile.schemas.js';

export type MessageKind = 'command' | 'question' | 'conversation';

export interface Intent {
  /** Language the user wrote in (for fallbacks and suggestions); null when unclear. */
  language: LocaleTag | null;
  kind: MessageKind;
  /** AI purpose to try first; CHAT is always the fallback. */
  purpose: AIPurpose;
}

/**
 * Cheap, deterministic pre-classification. It never decides *what* to do (the model picks
 * tools and the backend validates them); it only routes the message to the configured model
 * of the right purpose and picks the language of fixed texts.
 */
@Injectable()
export class IntentService {
  classify(text: string): Intent {
    const folded = fold(text);
    const words = folded.split(/[^a-z0-9]+/).filter(Boolean);
    const kind = kindOf(folded, words);
    return {
      language: languageOf(words),
      kind,
      purpose:
        kind === 'command'
          ? 'FINANCIAL_INTERPRETATION'
          : kind === 'question'
            ? 'ANALYSIS'
            : 'CHAT',
    };
  }
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const QUESTION_STARTS = [
  // pt
  'quanto',
  'quantos',
  'quanta',
  'quantas',
  'qual',
  'quais',
  'quando',
  'onde',
  'como',
  'tenho',
  'existe',
  'mostre',
  'mostra',
  'liste',
  'compare',
  'compara',
  // en
  'how',
  'what',
  'which',
  'when',
  'where',
  'do',
  'does',
  'did',
  'is',
  'are',
  'show',
  'list',
  // es
  'cuanto',
  'cuantos',
  'cuanta',
  'cuantas',
  'cual',
  'cuales',
  'cuando',
  'donde',
  'como',
  'tengo',
  'muestra',
  'muestrame',
  'lista',
  'compara',
];

/** Stems of verbs that register, change or remove data, in the three languages. */
const COMMAND_STEMS = [
  // pt
  'gastei',
  'paguei',
  'recebi',
  'comprei',
  'investi',
  'transferi',
  'registr',
  'adicion',
  'lanc',
  'apag',
  'exclu',
  'delet',
  'remov',
  'alter',
  'mud',
  'atualiz',
  'cri',
  'cadastr',
  'aport',
  // en
  'spent',
  'paid',
  'received',
  'bought',
  'invested',
  'transferred',
  'add',
  'record',
  'delete',
  'remove',
  'change',
  'update',
  'create',
  'log',
  // es
  'gaste',
  'pague',
  'recibi',
  'compre',
  'inverti',
  'transferi',
  'anad',
  'regist',
  'borr',
  'elimin',
  'cambi',
  'actualiz',
  'cre',
];

function kindOf(folded: string, words: string[]): MessageKind {
  const first = words[0] ?? '';
  if (folded.includes('?') || QUESTION_STARTS.includes(first)) return 'question';
  if (words.some((word) => COMMAND_STEMS.some((stem) => word.startsWith(stem))))
    return 'command';
  if (/\d/.test(folded)) return 'command'; // "50 reais de pizza"
  return 'conversation';
}

const STOPWORDS: Record<LocaleTag, string[]> = {
  'pt-BR': [
    'de',
    'do',
    'da',
    'que',
    'com',
    'no',
    'na',
    'em',
    'meu',
    'minha',
    'meus',
    'minhas',
    'este',
    'esta',
    'mes',
    'hoje',
    'ontem',
    'reais',
    'quanto',
    'gastei',
    'paguei',
    'qual',
    'quais',
    'contas',
    'passado',
    'voce',
    'nao',
    'sim',
    'obrigado',
    'mais',
    'gastos',
    'aluguel',
    'tenho',
    'alguma',
    'conta',
    'atrasada',
    'vencem',
  ],
  'en-US': [
    'the',
    'of',
    'my',
    'did',
    'how',
    'much',
    'this',
    'last',
    'month',
    'today',
    'yesterday',
    'spent',
    'paid',
    'what',
    'which',
    'bills',
    'and',
    'is',
    'are',
    'i',
    'you',
    'thanks',
    'dollars',
    'show',
    'expenses',
    'week',
  ],
  'es-ES': [
    'el',
    'la',
    'los',
    'las',
    'de',
    'del',
    'que',
    'mi',
    'mis',
    'este',
    'esta',
    'mes',
    'hoy',
    'ayer',
    'cuanto',
    'gaste',
    'pague',
    'cual',
    'cuales',
    'pagos',
    'pasado',
    'semana',
    'euros',
    'gracias',
    'gastos',
    'y',
    'en',
    'con',
  ],
};

function languageOf(words: string[]): LocaleTag | null {
  const scores = (Object.entries(STOPWORDS) as [LocaleTag, string[]][]).map(
    ([locale, stopwords]) =>
      [locale, words.filter((word) => stopwords.includes(word)).length] as const,
  );
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (!best || best[1] === 0 || (second && second[1] === best[1])) return null;
  return best[0];
}
