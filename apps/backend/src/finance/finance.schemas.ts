import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { ApiException } from '../common/errors/api-error.js';
import { dto } from '../common/validation/zod-validation.pipe.js';
import { currencyCode } from '../profile/profile.schemas.js';
import { parseCalendarDate } from './dates.js';

/** Business-rule violation: the input is well-formed but not allowed (422 + specific code). */
export function ruleViolation(
  code: string,
  message: string,
  details?: unknown,
): ApiException {
  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
}

const noControl = (value: string) => !/\p{Cc}/u.test(value);

const label = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(noControl, 'must not contain control characters');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(noControl, 'must not contain control characters')
    .transform((value) => (value === '' ? null : value))
    .nullable();

/** Calendar date "YYYY-MM-DD", real and between 1900 and 2100. */
export const calendarDate = z
  .string()
  .refine(
    (value) => parseCalendarDate(value) !== null,
    'must be a real date in YYYY-MM-DD',
  );

/** Money arrives as a string (preferred) or an exact JSON number; parsed per currency later. */
const money = z.union([z.string().max(32), z.number()]);

const tags = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(30)
      .refine(noControl, 'must not contain control characters'),
  )
  .max(10)
  .transform((items) => [...new Set(items)]);

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE', 'INVESTMENT', 'TRANSFER'] as const;
export const TRANSACTION_STATUSES = ['PENDING', 'COMPLETED', 'CANCELED'] as const;
export const PAYMENT_METHODS = [
  'CASH',
  'PIX',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'BANK_TRANSFER',
  'BANK_SLIP',
  'DIRECT_DEBIT',
  'OTHER',
] as const;
export const ACCOUNT_TYPES = [
  'CHECKING',
  'SAVINGS',
  'WALLET',
  'CASH',
  'DIGITAL',
  'CREDIT_CARD',
  'INVESTMENT',
  'OTHER',
] as const;
export const CATEGORY_KINDS = ['INCOME', 'EXPENSE', 'INVESTMENT', 'GENERAL'] as const;

// ───────────────────────────── Accounts ─────────────────────────────

const dayOfMonth = z.number().int().min(1).max(31).nullable();

export const createAccountSchema = dto({
  type: z.enum(ACCOUNT_TYPES),
  name: label(100),
  institution: optionalText(100).optional(),
  currency: currencyCode.optional(),
  initialBalance: money.optional(),
  creditLimit: money.nullable().optional(),
  closingDay: dayOfMonth.optional(),
  dueDay: dayOfMonth.optional(),
  lastFourDigits: z
    .string()
    .regex(/^\d{4}$/, 'must be 4 digits')
    .nullable()
    .optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/** Type and currency are fixed after creation (transactions depend on them). */
export const updateAccountSchema = dto({
  name: label(100),
  institution: optionalText(100),
  initialBalance: money,
  creditLimit: money.nullable(),
  closingDay: dayOfMonth,
  dueDay: dayOfMonth,
  lastFourDigits: z
    .string()
    .regex(/^\d{4}$/, 'must be 4 digits')
    .nullable(),
  isArchived: z.boolean(),
  version: z.number().int().min(1),
})
  .partial()
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'version'),
    'at least one field is required',
  );
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

// ──────────────────────────── Categories ────────────────────────────

export const createCategorySchema = dto({
  name: label(100),
  kind: z.enum(CATEGORY_KINDS),
  parentId: z.uuid().nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'must be #RRGGBB')
    .nullable()
    .optional(),
  icon: z
    .string()
    .trim()
    .max(50)
    .regex(/^[a-z0-9-]*$/, 'must be lower-case, digits or dashes')
    .nullable()
    .optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = dto({
  name: label(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'must be #RRGGBB')
    .nullable(),
  icon: z
    .string()
    .trim()
    .max(50)
    .regex(/^[a-z0-9-]*$/, 'must be lower-case, digits or dashes')
    .nullable(),
  isArchived: z.boolean(),
})
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const listCategoriesSchema = dto({
  kind: z.enum(CATEGORY_KINDS).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

// ─────────────────────────── Transactions ───────────────────────────

/**
 * Creation. Links to installments, recurrences and investments are created only by their own
 * services; sync fields, owner and version are never accepted from clients.
 */
export const createTransactionSchema = dto({
  type: z.enum(TRANSACTION_TYPES),
  description: label(255),
  amount: money,
  currency: currencyCode.optional(),
  occurredOn: calendarDate,
  dueOn: calendarDate.nullable().optional(),
  paidOn: calendarDate.nullable().optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  transferAccountId: z.uuid().nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  notes: optionalText(1000).optional(),
  tags: tags.optional(),
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/** Partial update; `version` enables optimistic concurrency (409 on mismatch). */
export const updateTransactionSchema = dto({
  type: z.enum(TRANSACTION_TYPES),
  description: label(255),
  amount: money,
  currency: currencyCode,
  occurredOn: calendarDate,
  dueOn: calendarDate.nullable(),
  paidOn: calendarDate.nullable(),
  status: z.enum(TRANSACTION_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  accountId: z.uuid().nullable(),
  transferAccountId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  notes: optionalText(1000),
  tags,
  version: z.number().int().min(1),
})
  .partial()
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'version'),
    'at least one field is required',
  );
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).min(1));

export const searchTransactionsSchema = dto({
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  type: csv(TRANSACTION_TYPES).optional(),
  status: csv(TRANSACTION_STATUSES).optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  minAmount: z
    .string()
    .regex(/^\d{1,15}(\.\d{1,4})?$/)
    .optional(),
  maxAmount: z
    .string()
    .regex(/^\d{1,15}(\.\d{1,4})?$/)
    .optional(),
  overdue: z.enum(['true', 'false']).optional(),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});
export type SearchTransactionsInput = z.infer<typeof searchTransactionsSchema>;

// ─────────────────────────── Installments ───────────────────────────

/** An installment purchase is always an expense; each parcel becomes a transaction. */
export const createInstallmentSchema = dto({
  description: label(255),
  totalAmount: money,
  installmentCount: z.number().int().min(2).max(420),
  purchasedOn: calendarDate,
  /** Defaults to the card statement due date, or one month after the purchase. */
  firstDueOn: calendarDate.optional(),
  accountId: z.uuid().nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  notes: optionalText(1000).optional(),
  tags: tags.optional(),
});
export type CreateInstallmentInput = z.infer<typeof createInstallmentSchema>;

// ──────────────────────────── Recurrences ───────────────────────────

export const RECURRING_TYPES = ['INCOME', 'EXPENSE', 'INVESTMENT'] as const;
export const FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'] as const;
export const INTERVAL_UNITS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;

/** The schedule (frequency, interval, day, start) is fixed after creation. */
export const createRecurringSchema = dto({
  type: z.enum(RECURRING_TYPES),
  description: label(255),
  amount: money,
  accountId: z.uuid().nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  frequency: z.enum(FREQUENCIES),
  /** CUSTOM only: every `intervalCount` `intervalUnit`s. */
  intervalCount: z.number().int().min(1).max(366).optional(),
  intervalUnit: z.enum(INTERVAL_UNITS).optional(),
  /** MONTHLY or CUSTOM/MONTH only ("todo dia 10"); clamped to short months. */
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  /** Defaults to today in the user's time zone. */
  startOn: calendarDate.optional(),
  endOn: calendarDate.nullable().optional(),
})
  .refine((body) => (body.frequency === 'CUSTOM') === (body.intervalUnit !== undefined), {
    message: 'intervalUnit is required for CUSTOM and only for CUSTOM',
    path: ['intervalUnit'],
  })
  .refine(
    (body) =>
      body.frequency === 'CUSTOM' ||
      body.intervalCount === undefined ||
      body.intervalCount === 1,
    { message: 'intervalCount is only for CUSTOM', path: ['intervalCount'] },
  )
  .refine(
    (body) =>
      body.dayOfMonth === undefined ||
      body.frequency === 'MONTHLY' ||
      (body.frequency === 'CUSTOM' && body.intervalUnit === 'MONTH'),
    { message: 'dayOfMonth is only for monthly schedules', path: ['dayOfMonth'] },
  );
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;

export const updateRecurringSchema = dto({
  description: label(255),
  amount: money,
  accountId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  endOn: calendarDate.nullable(),
  isActive: z.boolean(),
  version: z.number().int().min(1),
})
  .partial()
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'version'),
    'at least one field is required',
  );
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;

// ──────────────────────────── Investments ───────────────────────────

export const INVESTMENT_CLASSES = [
  'STOCK',
  'REIT',
  'ETF',
  'CRYPTO',
  'TREASURY',
  'CDB',
  'LCI_LCA',
  'FUND',
  'PENSION',
  'OTHER',
] as const;

/** Decimal(28,10) quantity as text ("0.00012345"); never a float. */
const quantity = z
  .string()
  .trim()
  .regex(
    /^\d{1,18}(\.\d{1,10})?$/,
    'must be a non-negative decimal with up to 10 places',
  );

const symbol = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9.\-_/:]+$/, 'must be a ticker (letters, digits, . - _ / :)')
  .transform((value) => value.toUpperCase())
  .nullable();

export const createInvestmentSchema = dto({
  assetClass: z.enum(INVESTMENT_CLASSES),
  name: label(150),
  symbol: symbol.optional(),
  accountId: z.uuid().nullable().optional(),
  currency: currencyCode.optional(),
  /** Opening position already held (before contributions registered here). */
  quantity: quantity.optional(),
  totalCost: money.optional(),
  notes: optionalText(1000).optional(),
});
export type CreateInvestmentInput = z.infer<typeof createInvestmentSchema>;

/** Currency is fixed after creation (contributions depend on it). */
export const updateInvestmentSchema = dto({
  assetClass: z.enum(INVESTMENT_CLASSES),
  name: label(150),
  symbol,
  accountId: z.uuid().nullable(),
  quantity,
  totalCost: money,
  notes: optionalText(1000),
  version: z.number().int().min(1),
})
  .partial()
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'version'),
    'at least one field is required',
  );
export type UpdateInvestmentInput = z.infer<typeof updateInvestmentSchema>;

/** A contribution ("aporte") is an INVESTMENT transaction linked to the position. */
export const contributionSchema = dto({
  amount: money,
  /** Defaults to today in the user's time zone. */
  occurredOn: calendarDate.optional(),
  /** Units bought, added to the position's quantity. */
  quantity: quantity.optional(),
  /** Account the money leaves from (its balance decreases). */
  accountId: z.uuid().nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  status: z.enum(['PENDING', 'COMPLETED']).optional(),
  description: label(255).optional(),
  notes: optionalText(1000).optional(),
});
export type ContributionInput = z.infer<typeof contributionSchema>;

// ───────────────────────────── Queries ─────────────────────────────

export const periodSchema = dto({
  from: calendarDate,
  to: calendarDate,
}).refine((period) => period.from <= period.to, {
  message: 'from must not be after to',
  path: ['to'],
});

export const byPeriodSchema = dto({
  from: calendarDate,
  to: calendarDate,
  groupBy: z.enum(['day', 'month']).optional(),
}).refine((period) => period.from <= period.to, {
  message: 'from must not be after to',
  path: ['to'],
});

export const upcomingSchema = dto({
  days: z.coerce.number().int().min(1).max(366).optional(),
});
