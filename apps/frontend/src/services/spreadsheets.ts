import { api } from './api';

export type SpreadsheetStatus = 'PENDING_CREATION' | 'ACTIVE' | 'ERROR' | 'ARCHIVED';

export interface Spreadsheet {
  id: string;
  name: string;
  status: SpreadsheetStatus;
  isActive: boolean;
  locale: string;
  googleSpreadsheetId: string | null;
  url: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listSpreadsheets(): Promise<Spreadsheet[]> {
  return (await api.get<Spreadsheet[]>('/spreadsheets')).data;
}

/** Creates the spreadsheet, or finishes/repairs it when it already exists (idempotent). */
export async function createSpreadsheet(name?: string): Promise<Spreadsheet> {
  return (await api.post<Spreadsheet>('/spreadsheets', name ? { name } : {})).data;
}
