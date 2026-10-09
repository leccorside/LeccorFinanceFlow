import { z } from 'zod';
import type { AccountsService } from '../../finance/accounts.service.js';
import type { CategoriesService } from '../../finance/categories.service.js';
import { ruleViolation } from '../../finance/finance.schemas.js';
import type { InvestmentsService } from '../../finance/investments.service.js';
import type { ToolContext } from './tool.types.js';

/**
 * The model may refer to accounts, categories and investments by id (from a previous result)
 * or by the name the user said. Names are matched case/accent-insensitively among the user's
 * own records only; no match or several matches never guess: they answer with the options.
 */

export function fold(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export const reference = {
  id: z.uuid().nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
};

/** `xId` and `xName` are alternatives: refuse both at once. */
export function onlyOne(idKey: string, nameKey: string) {
  return (value: Record<string, unknown>) =>
    !(
      value[idKey] !== undefined &&
      value[idKey] !== null &&
      value[nameKey] !== undefined
    );
}

const MAX_OPTIONS = 30;

/** id (checked by the service later) | name → id | undefined (not mentioned) | null (none). */
export async function accountId(
  accounts: AccountsService,
  ctx: ToolContext,
  id: string | null | undefined,
  name: string | undefined,
  field = 'account',
): Promise<string | null | undefined> {
  if (name === undefined) return id;
  const all = await accounts.list(ctx.user, false);
  const matches = all.filter((account) => fold(account.name) === fold(name));
  if (matches.length === 1) return (matches[0] as { id: string }).id;
  if (matches.length === 0) {
    throw ruleViolation(`${field}_not_found`, 'Nenhuma conta com esse nome.', {
      available: all.slice(0, MAX_OPTIONS).map((account) => account.name),
    });
  }
  throw ruleViolation(`${field}_ambiguous`, 'Há mais de uma conta com esse nome.', {
    candidates: matches.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
    })),
  });
}

/** Category by name in the user's language ("Alimentação"), or "Pai > Filha". */
export async function categoryId(
  categories: CategoriesService,
  ctx: ToolContext,
  id: string | null | undefined,
  name: string | undefined,
): Promise<string | null | undefined> {
  if (name === undefined) return id;
  const all = await categories.list(ctx.user, { includeArchived: false });
  const [parentName, childName] = name.includes('>')
    ? name.split('>').map((part) => part.trim())
    : [undefined, name];
  const parents = parentName
    ? all.filter((item) => item.parentId === null && fold(item.name) === fold(parentName))
    : null;
  const matches = all.filter(
    (item) =>
      fold(item.name) === fold(childName ?? '') &&
      (parents === null || parents.some((parent) => parent.id === item.parentId)),
  );
  if (matches.length === 1) return (matches[0] as { id: string }).id;
  if (matches.length === 0) {
    throw ruleViolation('category_not_found', 'Nenhuma categoria com esse nome.', {
      available: all.slice(0, MAX_OPTIONS * 2).map((item) => ({
        name: item.name,
        kind: item.kind,
        isSubcategory: item.parentId !== null,
      })),
    });
  }
  throw ruleViolation('category_ambiguous', 'Há mais de uma categoria com esse nome.', {
    candidates: matches.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
    })),
  });
}

export async function investmentId(
  investments: InvestmentsService,
  ctx: ToolContext,
  id: string | undefined,
  name: string | undefined,
): Promise<string> {
  if (id) return id;
  const all = await investments.list(ctx.user);
  const matches = all.filter(
    (item) =>
      fold(item.name) === fold(name ?? '') ||
      (item.symbol !== null && fold(item.symbol) === fold(name ?? '')),
  );
  if (matches.length === 1) return (matches[0] as { id: string }).id;
  if (matches.length === 0) {
    throw ruleViolation('investment_not_found', 'Nenhum investimento com esse nome.', {
      available: all.slice(0, MAX_OPTIONS).map((item) => item.name),
    });
  }
  throw ruleViolation(
    'investment_ambiguous',
    'Há mais de um investimento com esse nome.',
    {
      candidates: matches.map((item) => ({
        id: item.id,
        name: item.name,
        assetClass: item.assetClass,
      })),
    },
  );
}
