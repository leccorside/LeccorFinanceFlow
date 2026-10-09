import { z } from 'zod';
import { calendarDate } from '../../finance/finance.schemas.js';
import { REPORT_FORMATS, REPORT_TYPES } from '../../reports/report.types.js';
import type { ReportsService } from '../../reports/reports.service.js';
import { defineTool, type ToolSpec } from './tool.types.js';

const USER = ['USER'] as const;

export function reportTools(deps: { reports: ReportsService }): ToolSpec[] {
  const { reports } = deps;
  return [
    defineTool({
      name: 'generate_report',
      version: 1,
      description:
        'Gera um relatório em PDF ou XLSX e devolve o link de download (válido por pouco tempo; a interface mostra o botão). Tipos: MONTHLY (um mês inteiro: use month "AAAA-MM"), ANNUAL (um ano: use year), INCOME, EXPENSES, CATEGORIES, INVESTMENTS, ACCOUNTS, CASH_FLOW, CONSOLIDATED (use month, year ou from/to). "Relatório de setembro" sem ano = setembro do ano corrente. Formato padrão: PDF. Informe o período uma única vez.',
      input: z
        .strictObject({
          type: z.enum(REPORT_TYPES),
          format: z.enum(REPORT_FORMATS).optional(),
          month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .optional(),
          year: z.number().int().min(1900).max(2100).optional(),
          from: calendarDate.optional(),
          to: calendarDate.optional(),
        })
        .refine(
          (value) =>
            [
              value.from !== undefined || value.to !== undefined,
              value.month !== undefined,
              value.year !== undefined,
            ].filter(Boolean).length === 1,
          'give the period as month, year or from/to (only one)',
        ),
      roles: USER,
      risk: 'write',
      // A report changes no financial data: nothing to sync to the spreadsheet.
      syncAfter: false,
      run: (ctx, input) =>
        reports.create(ctx.user, { ...input, format: input.format ?? 'PDF' }),
    }),
  ];
}
