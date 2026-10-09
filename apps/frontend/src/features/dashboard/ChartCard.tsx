import { type ReactNode, useId } from 'react';
import { useI18n } from '../../i18n/context';

/**
 * A chart with what screen readers need: a heading, a one-sentence summary (the image's
 * name) and the full data as a real table, one click away. The visual chart itself is
 * decorative for assistive technology.
 */
export function ChartCard({
  title,
  summary,
  empty,
  table,
  children,
  className,
}: {
  title: string;
  summary: string;
  empty: boolean;
  table: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <section
      className={className ? `chart-card ${className}` : 'chart-card'}
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{title}</h2>
      {empty ? (
        <p className="chart-empty">{t('dashboard.chart.noData')}</p>
      ) : (
        <>
          <p className="chart-summary">{summary}</p>
          <div className="chart-canvas" aria-hidden="true">
            {children}
          </div>
          <details className="chart-table">
            <summary>{t('dashboard.chart.table')}</summary>
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">{title}</caption>
                <thead>
                  <tr>
                    {table.headers.map((header) => (
                      <th key={header} scope="col">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, column) =>
                        column === 0 ? (
                          <th key={column} scope="row">
                            {cell}
                          </th>
                        ) : (
                          <td key={column}>{cell}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
