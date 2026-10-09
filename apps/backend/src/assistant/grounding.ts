/**
 * Numeric grounding: every amount or percentage the assistant states must come from tool
 * results (or what the user said), possibly combined as a sum, difference, share or change
 * of two of them ("R$ 200 a mais que no mês passado", "+32%"). Anything else is treated as
 * an invented number.
 */

const NUMBER = String.raw`\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?`;
const CURRENCY_PREFIX = String.raw`(?:R\$|US\$|\$|€|£|¥|\b(?:BRL|USD|EUR|GBP|JPY|ARS|CLP|MXN|COP|CAD|AUD|CHF)\b)\s?-?`;
const CURRENCY_SUFFIX = String.raw`\s?(?:€|\b(?:BRL|USD|EUR|GBP|JPY|reais|real|d[oó]lares|dollars|euros)\b)`;

const PATTERNS: { regex: RegExp; percent: boolean; group: number }[] = [
  { regex: new RegExp(`${CURRENCY_PREFIX}(${NUMBER})`, 'gu'), percent: false, group: 1 },
  { regex: new RegExp(`(${NUMBER})${CURRENCY_SUFFIX}`, 'giu'), percent: false, group: 1 },
  { regex: new RegExp(`(${NUMBER})\\s?%`, 'gu'), percent: true, group: 1 },
];

export interface CitedValue {
  text: string;
  value: number;
  decimals: number;
  percent: boolean;
}

/** "1.184,50" / "1,184.50" / "1 184,50" / "87.45" → value and stated precision. */
export function parseLocalizedNumber(
  text: string,
): { value: number; decimals: number } | null {
  const compact = text.replace(/[\s\u00a0\u202f]/g, '');
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let decimalSeparator: string | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? ',' : '.';
    const occurrences = compact.split(separator).length - 1;
    const after = compact.length - compact.lastIndexOf(separator) - 1;
    // One separator followed by exactly three digits is a thousands separator ("1.500").
    decimalSeparator = occurrences > 1 || after === 3 ? null : separator;
  }
  let integer = compact;
  let fraction = '';
  if (decimalSeparator) {
    const index = compact.lastIndexOf(decimalSeparator);
    integer = compact.slice(0, index);
    fraction = compact.slice(index + 1);
  }
  integer = integer.replace(/[.,]/g, '');
  if (!/^\d+$/.test(integer) || !/^\d*$/.test(fraction)) return null;
  const value = Number(fraction ? `${integer}.${fraction}` : integer);
  return Number.isFinite(value) ? { value, decimals: fraction.length } : null;
}

/** Amounts (with a currency marker) and percentages stated in a text. */
export function citedValues(text: string): CitedValue[] {
  const found = new Map<string, CitedValue>();
  for (const { regex, percent, group } of PATTERNS) {
    for (const match of text.matchAll(regex)) {
      const raw = match[group] as string;
      const parsed = parseLocalizedNumber(raw);
      if (!parsed) continue;
      const key = `${match.index}:${percent}`;
      if (!found.has(key)) found.set(key, { text: match[0].trim(), ...parsed, percent });
    }
  }
  return [...found.values()];
}

/** Every number found in tool results (numbers and numeric strings, at any depth). */
export function numbersIn(value: unknown, into: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) into.push(value);
  else if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    into.push(Number(value));
  } else if (Array.isArray(value)) value.forEach((item) => numbersIn(item, into));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => numbersIn(item, into));
  }
  return into;
}

/** Numbers the user typed ("gastei 89 reais"), in any of the supported formats. */
export function numbersInText(text: string): number[] {
  return [...text.matchAll(new RegExp(NUMBER, 'gu'))]
    .map((match) => parseLocalizedNumber(match[0])?.value)
    .filter((value): value is number => value !== undefined);
}

const MAX_BASE = 200;

/** Grounded values plus sums, differences, shares and changes of any two of them. */
export function groundedSet(base: number[]): number[] {
  const unique = [...new Set([0, ...base.map((value) => Math.abs(value))])].slice(
    0,
    MAX_BASE,
  );
  const all = [...unique];
  for (const a of unique) {
    for (const b of unique) {
      all.push(a + b, Math.abs(a - b));
      if (b !== 0) all.push((a / b) * 100, Math.abs(((a - b) / b) * 100));
    }
  }
  return all;
}

function matches(cited: CitedValue, grounded: number[]): boolean {
  const target = Math.abs(cited.value);
  return grounded.some(
    (value) => Math.abs(Number(value.toFixed(cited.decimals)) - target) < 1e-9,
  );
}

/** Cited values with no grounding (empty when the answer is fully backed by data). */
export function ungroundedValues(answer: string, grounded: number[]): string[] {
  return citedValues(answer)
    .filter((cited) => !matches(cited, grounded))
    .map((cited) => cited.text);
}
