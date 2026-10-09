import { z } from 'zod';
import type { DashboardService } from '../../dashboard/dashboard.service.js';
import { parseCalendarDate } from '../../finance/dates.js';
import { calendarDate } from '../../finance/finance.schemas.js';
import { PERIOD_KEYS } from '../../dashboard/periods.js';
import { defineTool, type ToolSpec } from './tool.types.js';

const USER = ['USER'] as const;

export function insightTools(deps: { dashboard: DashboardService }): ToolSpec[] {
  const { dashboard } = deps;
  return [
    defineTool({
      name: 'get_financial_insights',
      version: 1,
      description:
        'Observações calculadas a partir dos dados do usuário no período (mesmas do painel): variação de despesas contra o período anterior, despesas como % da receita, categoria que mais cresceu, maior categoria, contas a vencer em 7 dias, contas vencidas e taxa de economia dos últimos 3 meses. Cada item traz kind, values e o período. Use para "insights", "como estou indo", "o que mudou". Apresente como informação, nunca como recomendação de investimento ou promessa.',
      input: z
        .strictObject({
          period: z.enum(PERIOD_KEYS).optional(),
          from: calendarDate.optional(),
          to: calendarDate.optional(),
        })
        .refine(
          (value) =>
            value.period === 'custom'
              ? Boolean(value.from && value.to)
              : !value.from && !value.to,
          'from/to only with period=custom (and then both)',
        ),
      roles: USER,
      risk: 'read',
      run: (ctx, input) =>
        dashboard.insights(ctx.user, {
          period: input.period ?? 'month',
          from: input.from ? (parseCalendarDate(input.from) ?? undefined) : undefined,
          to: input.to ? (parseCalendarDate(input.to) ?? undefined) : undefined,
        }),
    }),
  ];
}
