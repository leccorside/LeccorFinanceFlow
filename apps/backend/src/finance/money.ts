import { Prisma } from '../generated/prisma/client.js';

/** Decimal(19,4): up to 15 integer digits and 4 decimals. */
const AMOUNT = /^(\d{1,15})(?:\.(\d{1,4}))?$/;

/** Minor units of a currency (BRL 2, JPY 0, BHD 3), capped at the column's 4 decimals. */
export function currencyDigits(currency: string): number {
  const digits =
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return Math.min(digits, 4);
}

export type MoneyIssue = 'invalid_amount' | 'amount_not_positive' | 'too_many_decimals';

/**
 * Parses a money amount without ever going through binary floating point.
 * Accepts strings ("1234.56") and, for convenience, JSON numbers whose canonical text form
 * is already exact (10, 10.5). Rejects exponent notation, signs, separators and more decimals
 * than the currency allows.
 */
export function parseMoney(
  value: unknown,
  currency: string,
  options: { allowZero?: boolean; allowNegative?: boolean } = {},
): { ok: true; value: Prisma.Decimal } | { ok: false; issue: MoneyIssue } {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { ok: false, issue: 'invalid_amount' };
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return { ok: false, issue: 'invalid_amount' };
  }

  const negative = text.startsWith('-');
  if (negative) {
    if (!options.allowNegative) return { ok: false, issue: 'amount_not_positive' };
    text = text.slice(1);
  }
  const match = AMOUNT.exec(text);
  if (!match) return { ok: false, issue: 'invalid_amount' };
  if ((match[2]?.length ?? 0) > currencyDigits(currency)) {
    return { ok: false, issue: 'too_many_decimals' };
  }

  const decimal = new Prisma.Decimal(negative ? `-${text}` : text);
  if (
    decimal.isZero() ? !options.allowZero : decimal.isNegative() && !options.allowNegative
  ) {
    return { ok: false, issue: 'amount_not_positive' };
  }
  return { ok: true, value: decimal };
}

/** Canonical string for API responses: always the currency's decimals ("10.50", "1000"). */
export function moneyString(
  value: Prisma.Decimal | null | undefined,
  currency: string,
): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(currencyDigits(currency));
}

export const ZERO = new Prisma.Decimal(0);

export function sum(values: (Prisma.Decimal | null | undefined)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (total, value) => (value ? total.plus(value) : total),
    ZERO,
  );
}
