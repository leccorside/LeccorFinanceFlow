import { api } from './api';

export const REPORT_TYPES = [
  'MONTHLY',
  'ANNUAL',
  'INCOME',
  'EXPENSES',
  'CATEGORIES',
  'INVESTMENTS',
  'ACCOUNTS',
  'CASH_FLOW',
  'CONSOLIDATED',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportFormat = 'PDF' | 'XLSX';

export interface ReportRequest {
  type: ReportType;
  format: ReportFormat;
  from?: string;
  to?: string;
  month?: string;
  year?: number;
}

export interface Report {
  id: string;
  type: ReportType;
  format: ReportFormat;
  from: string;
  to: string;
  status: 'GENERATING' | 'READY' | 'FAILED' | 'EXPIRED';
  fileName: string | null;
  expiresAt: string;
  createdAt: string;
  /** Same-origin and session-protected: a plain link downloads it. */
  downloadUrl: string | null;
}

export async function createReport(request: ReportRequest): Promise<Report> {
  return (await api.post<Report>('/reports', request)).data;
}

export async function listReports(): Promise<Report[]> {
  return (await api.get<Report[]>('/reports')).data;
}
