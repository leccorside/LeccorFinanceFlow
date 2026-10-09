/** The fields of a transaction the dashboard shows (bills lists). */
export interface TransactionSummary {
  id: string;
  description: string;
  amount: string;
  currency: string;
  dueOn: string | null;
  occurredOn: string;
  isOverdue: boolean;
  category: { name: string } | null;
  account: { name: string } | null;
}
