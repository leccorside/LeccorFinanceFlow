import type { CategoryKind, RoleName } from '../generated/prisma/enums.js';

export interface SeedRole {
  name: RoleName;
  description: string;
}

export interface SeedCategory {
  systemKey: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
}

export const DEFAULT_ROLES: readonly SeedRole[] = [
  { name: 'ADMIN', description: 'Controle completo da plataforma.' },
  { name: 'USER', description: 'Controle apenas sobre os próprios dados financeiros.' },
];

/**
 * System categories shared by every user (owner_id = NULL).
 * `systemKey` is the stable identifier used for i18n and idempotent seeding;
 * `name` is the pt-BR default label.
 */
export const DEFAULT_CATEGORIES: readonly SeedCategory[] = [
  {
    systemKey: 'food',
    name: 'Alimentação',
    kind: 'EXPENSE',
    color: '#F97316',
    icon: 'utensils',
  },
  {
    systemKey: 'housing',
    name: 'Moradia',
    kind: 'EXPENSE',
    color: '#8B5CF6',
    icon: 'home',
  },
  {
    systemKey: 'transport',
    name: 'Transporte',
    kind: 'EXPENSE',
    color: '#0EA5E9',
    icon: 'car',
  },
  {
    systemKey: 'health',
    name: 'Saúde',
    kind: 'EXPENSE',
    color: '#EF4444',
    icon: 'heart-pulse',
  },
  {
    systemKey: 'education',
    name: 'Educação',
    kind: 'EXPENSE',
    color: '#6366F1',
    icon: 'book',
  },
  {
    systemKey: 'leisure',
    name: 'Lazer',
    kind: 'EXPENSE',
    color: '#EC4899',
    icon: 'party',
  },
  {
    systemKey: 'subscriptions',
    name: 'Assinaturas',
    kind: 'EXPENSE',
    color: '#14B8A6',
    icon: 'repeat',
  },
  {
    systemKey: 'shopping',
    name: 'Compras',
    kind: 'EXPENSE',
    color: '#F59E0B',
    icon: 'bag',
  },
  {
    systemKey: 'bills',
    name: 'Contas',
    kind: 'EXPENSE',
    color: '#64748B',
    icon: 'receipt',
  },
  {
    systemKey: 'travel',
    name: 'Viagens',
    kind: 'EXPENSE',
    color: '#06B6D4',
    icon: 'plane',
  },
  {
    systemKey: 'investments',
    name: 'Investimentos',
    kind: 'INVESTMENT',
    color: '#22C55E',
    icon: 'trending-up',
  },
  {
    systemKey: 'salary',
    name: 'Salário',
    kind: 'INCOME',
    color: '#16A34A',
    icon: 'wallet',
  },
  {
    systemKey: 'freelance',
    name: 'Freelance',
    kind: 'INCOME',
    color: '#84CC16',
    icon: 'laptop',
  },
  { systemKey: 'other', name: 'Outros', kind: 'GENERAL', color: '#94A3B8', icon: 'dots' },
];
