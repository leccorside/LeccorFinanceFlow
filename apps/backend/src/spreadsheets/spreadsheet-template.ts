import type { LocaleTag } from '../profile/profile.schemas.js';

/**
 * Declarative layout of the financial spreadsheet. Tabs and columns are identified by stable
 * keys (stored as developer metadata), never by their localized titles, so the sync (PASSO 11)
 * survives renamed tabs and reordered columns.
 */

export const TEMPLATE_VERSION = 1;

export type ColumnFormat =
  'text' | 'currency' | 'date' | 'datetime' | 'integer' | 'decimal' | 'percent';

export type ListKey =
  | 'transactionType'
  | 'transactionStatus'
  | 'paymentMethod'
  | 'yesNo'
  | 'frequency'
  | 'accountType'
  | 'assetClass'
  | 'categoryKind';

export interface ColumnSpec {
  key: string;
  format: ColumnFormat;
  width: number;
  /** Dropdown validation with localized values. */
  list?: ListKey;
  /** Hidden + protected technical column (IDs and versions). */
  technical?: boolean;
}

export type TabKind = 'data' | 'view' | 'planning' | 'dashboard' | 'summary';

export interface TabSpec {
  key: TabKey;
  kind: TabKind;
  color: string;
  columns: ColumnSpec[];
}

export type TabKey =
  | 'dashboard'
  | 'transactions'
  | 'incomes'
  | 'expenses'
  | 'accounts'
  | 'investments'
  | 'categories'
  | 'budget'
  | 'goals'
  | 'monthly_summary';

/** Hidden columns on every data tab: the app's identity and version of each row. */
const TECHNICAL: ColumnSpec[] = [
  { key: 'record_id', format: 'text', width: 280, technical: true },
  { key: 'record_version', format: 'integer', width: 110, technical: true },
  { key: 'synced_at', format: 'datetime', width: 160, technical: true },
];

const view = (key: TabKey, color: string): TabSpec => ({
  key,
  kind: 'view',
  color,
  columns: [
    { key: 'occurred_on', format: 'date', width: 110 },
    { key: 'description', format: 'text', width: 260 },
    { key: 'category', format: 'text', width: 160 },
    { key: 'amount', format: 'currency', width: 130 },
    { key: 'status', format: 'text', width: 120 },
    { key: 'account', format: 'text', width: 160 },
  ],
});

export const TABS: TabSpec[] = [
  {
    key: 'dashboard',
    kind: 'dashboard',
    color: '#0F766E',
    columns: [
      { key: 'indicator', format: 'text', width: 240 },
      { key: 'value', format: 'currency', width: 160 },
    ],
  },
  {
    key: 'transactions',
    kind: 'data',
    color: '#2563EB',
    columns: [
      { key: 'type', format: 'text', width: 130, list: 'transactionType' },
      { key: 'description', format: 'text', width: 260 },
      { key: 'category', format: 'text', width: 160 },
      { key: 'subcategory', format: 'text', width: 160 },
      { key: 'amount', format: 'currency', width: 130 },
      { key: 'occurred_on', format: 'date', width: 110 },
      { key: 'due_on', format: 'date', width: 110 },
      { key: 'paid_on', format: 'date', width: 110 },
      { key: 'status', format: 'text', width: 120, list: 'transactionStatus' },
      { key: 'payment_method', format: 'text', width: 160, list: 'paymentMethod' },
      { key: 'account', format: 'text', width: 160 },
      { key: 'bank', format: 'text', width: 140 },
      { key: 'card', format: 'text', width: 140 },
      { key: 'installment_number', format: 'integer', width: 90 },
      { key: 'installment_total', format: 'integer', width: 110 },
      { key: 'recurring', format: 'text', width: 100, list: 'yesNo' },
      { key: 'frequency', format: 'text', width: 120, list: 'frequency' },
      { key: 'notes', format: 'text', width: 240 },
      { key: 'tags', format: 'text', width: 160 },
      { key: 'created_at', format: 'datetime', width: 150 },
      { key: 'updated_at', format: 'datetime', width: 150 },
      ...TECHNICAL,
    ],
  },
  view('incomes', '#16A34A'),
  view('expenses', '#DC2626'),
  {
    key: 'accounts',
    kind: 'data',
    color: '#7C3AED',
    columns: [
      { key: 'name', format: 'text', width: 200 },
      { key: 'account_type', format: 'text', width: 160, list: 'accountType' },
      { key: 'institution', format: 'text', width: 160 },
      { key: 'currency', format: 'text', width: 90 },
      { key: 'initial_balance', format: 'currency', width: 140 },
      { key: 'credit_limit', format: 'currency', width: 140 },
      { key: 'closing_day', format: 'integer', width: 110 },
      { key: 'due_day', format: 'integer', width: 110 },
      ...TECHNICAL,
    ],
  },
  {
    key: 'investments',
    kind: 'data',
    color: '#CA8A04',
    columns: [
      { key: 'name', format: 'text', width: 200 },
      { key: 'asset_class', format: 'text', width: 150, list: 'assetClass' },
      { key: 'symbol', format: 'text', width: 100 },
      { key: 'quantity', format: 'decimal', width: 130 },
      { key: 'total_cost', format: 'currency', width: 140 },
      { key: 'currency', format: 'text', width: 90 },
      { key: 'account', format: 'text', width: 160 },
      { key: 'notes', format: 'text', width: 240 },
      ...TECHNICAL,
    ],
  },
  {
    key: 'categories',
    kind: 'data',
    color: '#DB2777',
    columns: [
      { key: 'name', format: 'text', width: 200 },
      { key: 'kind', format: 'text', width: 140, list: 'categoryKind' },
      { key: 'parent', format: 'text', width: 200 },
      ...TECHNICAL,
    ],
  },
  {
    key: 'budget',
    kind: 'planning',
    color: '#EA580C',
    columns: [
      { key: 'month', format: 'text', width: 110 },
      { key: 'category', format: 'text', width: 180 },
      { key: 'planned', format: 'currency', width: 140 },
      { key: 'spent', format: 'currency', width: 140 },
      { key: 'remaining', format: 'currency', width: 140 },
    ],
  },
  {
    key: 'goals',
    kind: 'planning',
    color: '#0891B2',
    columns: [
      { key: 'goal', format: 'text', width: 220 },
      { key: 'target_amount', format: 'currency', width: 140 },
      { key: 'current_amount', format: 'currency', width: 140 },
      { key: 'deadline', format: 'date', width: 120 },
      { key: 'progress', format: 'percent', width: 110 },
    ],
  },
  {
    key: 'monthly_summary',
    kind: 'summary',
    color: '#4B5563',
    columns: [
      { key: 'month_start', format: 'date', width: 120 },
      { key: 'incomes', format: 'currency', width: 140 },
      { key: 'expenses', format: 'currency', width: 140 },
      { key: 'investments', format: 'currency', width: 140 },
      { key: 'balance', format: 'currency', width: 140 },
    ],
  },
];

export function tabSpec(key: TabKey): TabSpec {
  return TABS.find((tab) => tab.key === key) as TabSpec;
}

/** 0-based column index of `columnKey` in `tab`. */
export function columnIndex(tab: TabKey, columnKey: string): number {
  const index = tabSpec(tab).columns.findIndex((column) => column.key === columnKey);
  if (index < 0) throw new Error(`unknown column ${tab}.${columnKey}`);
  return index;
}

export interface LocaleTexts {
  spreadsheetTitle: (name: string) => string;
  tabs: Record<TabKey, string>;
  headers: Record<string, string>;
  lists: Record<ListKey, readonly string[]>;
  dashboard: {
    monthIncomes: string;
    monthExpenses: string;
    monthBalance: string;
    totalInvested: string;
    pendingBills: string;
    overdueBills: string;
    chartTitle: string;
  };
}

/**
 * Lists keep the same order across locales, so position maps to the domain enum:
 * transactionType = [INCOME, EXPENSE, INVESTMENT, TRANSFER],
 * transactionStatus = [PENDING, COMPLETED, CANCELED], yesNo = [true, false],
 * paymentMethod/frequency/accountType/assetClass/categoryKind follow the Prisma enum order.
 */
export const TEXTS: Record<LocaleTag, LocaleTexts> = {
  'pt-BR': {
    spreadsheetTitle: (name) => `Controle Financeiro — ${name}`,
    tabs: {
      dashboard: 'Dashboard',
      transactions: 'Movimentações',
      incomes: 'Receitas',
      expenses: 'Despesas',
      accounts: 'Contas',
      investments: 'Investimentos',
      categories: 'Categorias',
      budget: 'Orçamento',
      goals: 'Metas',
      monthly_summary: 'Resumo Mensal',
    },
    headers: {
      indicator: 'Indicador',
      value: 'Valor',
      type: 'Tipo',
      description: 'Descrição',
      category: 'Categoria',
      subcategory: 'Subcategoria',
      amount: 'Valor',
      occurred_on: 'Data',
      due_on: 'Vencimento',
      paid_on: 'Pagamento',
      status: 'Status',
      payment_method: 'Forma de pagamento',
      account: 'Conta',
      bank: 'Banco',
      card: 'Cartão',
      installment_number: 'Parcela',
      installment_total: 'Total de parcelas',
      recurring: 'Recorrente',
      frequency: 'Frequência',
      notes: 'Observação',
      tags: 'Tags',
      created_at: 'Criado em',
      updated_at: 'Atualizado em',
      record_id: 'ID (não editar)',
      record_version: 'Versão (não editar)',
      synced_at: 'Sincronizado em (não editar)',
      name: 'Nome',
      account_type: 'Tipo de conta',
      institution: 'Instituição',
      currency: 'Moeda',
      initial_balance: 'Saldo inicial',
      credit_limit: 'Limite',
      closing_day: 'Dia de fechamento',
      due_day: 'Dia de vencimento',
      asset_class: 'Classe',
      symbol: 'Código',
      quantity: 'Quantidade',
      total_cost: 'Custo total',
      kind: 'Tipo',
      parent: 'Categoria pai',
      month: 'Mês (AAAA-MM)',
      planned: 'Planejado',
      spent: 'Gasto',
      remaining: 'Restante',
      goal: 'Meta',
      target_amount: 'Valor alvo',
      current_amount: 'Valor atual',
      deadline: 'Prazo',
      progress: 'Progresso',
      month_start: 'Mês',
      incomes: 'Receitas',
      expenses: 'Despesas',
      investments: 'Investimentos',
      balance: 'Saldo',
    },
    lists: {
      transactionType: ['Receita', 'Despesa', 'Investimento', 'Transferência'],
      transactionStatus: ['Pendente', 'Pago', 'Cancelado'],
      paymentMethod: [
        'Dinheiro',
        'Pix',
        'Cartão de débito',
        'Cartão de crédito',
        'Transferência bancária',
        'Boleto',
        'Débito automático',
        'Outro',
      ],
      yesNo: ['Sim', 'Não'],
      frequency: ['Semanal', 'Quinzenal', 'Mensal', 'Anual', 'Personalizada'],
      accountType: [
        'Conta corrente',
        'Conta poupança',
        'Carteira',
        'Dinheiro',
        'Conta digital',
        'Cartão de crédito',
        'Conta de investimento',
        'Outra',
      ],
      assetClass: [
        'Ações',
        'FIIs',
        'ETFs',
        'Criptomoedas',
        'Tesouro Direto',
        'CDB',
        'LCI/LCA',
        'Fundos',
        'Previdência',
        'Outros',
      ],
      categoryKind: ['Receita', 'Despesa', 'Investimento', 'Geral'],
    },
    dashboard: {
      monthIncomes: 'Receitas do mês',
      monthExpenses: 'Despesas do mês',
      monthBalance: 'Saldo do mês',
      totalInvested: 'Total investido',
      pendingBills: 'Contas pendentes',
      overdueBills: 'Contas vencidas',
      chartTitle: 'Receitas x Despesas (12 meses)',
    },
  },
  'en-US': {
    spreadsheetTitle: (name) => `Financial Control — ${name}`,
    tabs: {
      dashboard: 'Dashboard',
      transactions: 'Transactions',
      incomes: 'Income',
      expenses: 'Expenses',
      accounts: 'Accounts',
      investments: 'Investments',
      categories: 'Categories',
      budget: 'Budget',
      goals: 'Goals',
      monthly_summary: 'Monthly Summary',
    },
    headers: {
      indicator: 'Indicator',
      value: 'Value',
      type: 'Type',
      description: 'Description',
      category: 'Category',
      subcategory: 'Subcategory',
      amount: 'Amount',
      occurred_on: 'Date',
      due_on: 'Due date',
      paid_on: 'Payment date',
      status: 'Status',
      payment_method: 'Payment method',
      account: 'Account',
      bank: 'Bank',
      card: 'Card',
      installment_number: 'Installment',
      installment_total: 'Total installments',
      recurring: 'Recurring',
      frequency: 'Frequency',
      notes: 'Notes',
      tags: 'Tags',
      created_at: 'Created at',
      updated_at: 'Updated at',
      record_id: 'ID (do not edit)',
      record_version: 'Version (do not edit)',
      synced_at: 'Synced at (do not edit)',
      name: 'Name',
      account_type: 'Account type',
      institution: 'Institution',
      currency: 'Currency',
      initial_balance: 'Opening balance',
      credit_limit: 'Credit limit',
      closing_day: 'Closing day',
      due_day: 'Due day',
      asset_class: 'Asset class',
      symbol: 'Ticker',
      quantity: 'Quantity',
      total_cost: 'Total cost',
      kind: 'Kind',
      parent: 'Parent category',
      month: 'Month (YYYY-MM)',
      planned: 'Planned',
      spent: 'Spent',
      remaining: 'Remaining',
      goal: 'Goal',
      target_amount: 'Target amount',
      current_amount: 'Current amount',
      deadline: 'Deadline',
      progress: 'Progress',
      month_start: 'Month',
      incomes: 'Income',
      expenses: 'Expenses',
      investments: 'Investments',
      balance: 'Balance',
    },
    lists: {
      transactionType: ['Income', 'Expense', 'Investment', 'Transfer'],
      transactionStatus: ['Pending', 'Paid', 'Canceled'],
      paymentMethod: [
        'Cash',
        'Pix',
        'Debit card',
        'Credit card',
        'Bank transfer',
        'Bank slip',
        'Direct debit',
        'Other',
      ],
      yesNo: ['Yes', 'No'],
      frequency: ['Weekly', 'Biweekly', 'Monthly', 'Yearly', 'Custom'],
      accountType: [
        'Checking',
        'Savings',
        'Wallet',
        'Cash',
        'Digital account',
        'Credit card',
        'Investment account',
        'Other',
      ],
      assetClass: [
        'Stocks',
        'REITs',
        'ETFs',
        'Crypto',
        'Treasury bonds',
        'CDB',
        'LCI/LCA',
        'Funds',
        'Pension',
        'Other',
      ],
      categoryKind: ['Income', 'Expense', 'Investment', 'General'],
    },
    dashboard: {
      monthIncomes: 'Income this month',
      monthExpenses: 'Expenses this month',
      monthBalance: 'Balance this month',
      totalInvested: 'Total invested',
      pendingBills: 'Pending bills',
      overdueBills: 'Overdue bills',
      chartTitle: 'Income vs Expenses (12 months)',
    },
  },
  'es-ES': {
    spreadsheetTitle: (name) => `Control Financiero — ${name}`,
    tabs: {
      dashboard: 'Panel',
      transactions: 'Movimientos',
      incomes: 'Ingresos',
      expenses: 'Gastos',
      accounts: 'Cuentas',
      investments: 'Inversiones',
      categories: 'Categorías',
      budget: 'Presupuesto',
      goals: 'Metas',
      monthly_summary: 'Resumen Mensual',
    },
    headers: {
      indicator: 'Indicador',
      value: 'Valor',
      type: 'Tipo',
      description: 'Descripción',
      category: 'Categoría',
      subcategory: 'Subcategoría',
      amount: 'Importe',
      occurred_on: 'Fecha',
      due_on: 'Vencimiento',
      paid_on: 'Fecha de pago',
      status: 'Estado',
      payment_method: 'Forma de pago',
      account: 'Cuenta',
      bank: 'Banco',
      card: 'Tarjeta',
      installment_number: 'Cuota',
      installment_total: 'Total de cuotas',
      recurring: 'Recurrente',
      frequency: 'Frecuencia',
      notes: 'Observación',
      tags: 'Etiquetas',
      created_at: 'Creado el',
      updated_at: 'Actualizado el',
      record_id: 'ID (no editar)',
      record_version: 'Versión (no editar)',
      synced_at: 'Sincronizado el (no editar)',
      name: 'Nombre',
      account_type: 'Tipo de cuenta',
      institution: 'Entidad',
      currency: 'Moneda',
      initial_balance: 'Saldo inicial',
      credit_limit: 'Límite',
      closing_day: 'Día de cierre',
      due_day: 'Día de vencimiento',
      asset_class: 'Clase',
      symbol: 'Código',
      quantity: 'Cantidad',
      total_cost: 'Coste total',
      kind: 'Tipo',
      parent: 'Categoría padre',
      month: 'Mes (AAAA-MM)',
      planned: 'Previsto',
      spent: 'Gastado',
      remaining: 'Restante',
      goal: 'Meta',
      target_amount: 'Importe objetivo',
      current_amount: 'Importe actual',
      deadline: 'Plazo',
      progress: 'Progreso',
      month_start: 'Mes',
      incomes: 'Ingresos',
      expenses: 'Gastos',
      investments: 'Inversiones',
      balance: 'Saldo',
    },
    lists: {
      transactionType: ['Ingreso', 'Gasto', 'Inversión', 'Transferencia'],
      transactionStatus: ['Pendiente', 'Pagado', 'Cancelado'],
      paymentMethod: [
        'Efectivo',
        'Pix',
        'Tarjeta de débito',
        'Tarjeta de crédito',
        'Transferencia bancaria',
        'Boleto',
        'Domiciliación',
        'Otro',
      ],
      yesNo: ['Sí', 'No'],
      frequency: ['Semanal', 'Quincenal', 'Mensual', 'Anual', 'Personalizada'],
      accountType: [
        'Cuenta corriente',
        'Cuenta de ahorro',
        'Cartera',
        'Efectivo',
        'Cuenta digital',
        'Tarjeta de crédito',
        'Cuenta de inversión',
        'Otra',
      ],
      assetClass: [
        'Acciones',
        'Fondos inmobiliarios',
        'ETFs',
        'Criptomonedas',
        'Bonos del Tesoro',
        'CDB',
        'LCI/LCA',
        'Fondos',
        'Planes de pensiones',
        'Otros',
      ],
      categoryKind: ['Ingreso', 'Gasto', 'Inversión', 'General'],
    },
    dashboard: {
      monthIncomes: 'Ingresos del mes',
      monthExpenses: 'Gastos del mes',
      monthBalance: 'Saldo del mes',
      totalInvested: 'Total invertido',
      pendingBills: 'Pagos pendientes',
      overdueBills: 'Pagos vencidos',
      chartTitle: 'Ingresos vs Gastos (12 meses)',
    },
  },
};
