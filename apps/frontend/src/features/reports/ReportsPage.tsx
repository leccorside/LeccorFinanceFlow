import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { type FormEvent, useId, useState } from 'react';
import { isMessageKey } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import { apiErrorOf } from '../../services/api';
import {
  createReport,
  listReports,
  type Report,
  type ReportFormat,
  type ReportRequest,
  type ReportType,
  REPORT_TYPES,
} from '../../services/reports';
import { monthRange, type Preset, PRESETS, presetRange, todayIn } from './report-periods';

const REPORTS_KEY = ['reports'] as const;

function FormatIcon({ format }: { format: ReportFormat }) {
  return (
    <span className={`file-badge file-badge--${format.toLowerCase()}`} aria-hidden="true">
      {format}
    </span>
  );
}

function ReportLink({ report }: { report: Report }) {
  const { t, dateTime } = useI18n();
  if (!report.downloadUrl || !report.fileName) return null;
  return (
    <div className="report-download">
      <FormatIcon format={report.format} />
      <div>
        <a
          href={report.downloadUrl}
          download={report.fileName}
          className="report-download-link"
        >
          {t('reports.download', { name: report.fileName })}
        </a>
        <small>{t('reports.expiresAt', { time: dateTime(report.expiresAt) })}</small>
      </div>
    </div>
  );
}

/**
 * Pick a report, a format and a period; the file is generated on the server and offered
 * as a download that only this user can open and that expires shortly after.
 */
export function ReportsPage() {
  const { t, timeZone, calendarDate, dateTime } = useI18n();
  const queryClient = useQueryClient();
  const today = todayIn(timeZone);
  const [type, setType] = useState<ReportType>('MONTHLY');
  const [format, setFormat] = useState<ReportFormat>('PDF');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [invalid, setInvalid] = useState(false);
  const ids = {
    type: useId(),
    format: useId(),
    period: useId(),
    month: useId(),
    year: useId(),
    from: useId(),
    to: useId(),
  };

  const reports = useQuery({ queryKey: REPORTS_KEY, queryFn: listReports });
  const generate = useMutation({
    mutationFn: (body: ReportRequest) => createReport(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: REPORTS_KEY }),
  });

  const request = (): ReportRequest | null => {
    if (type === 'MONTHLY')
      return /^\d{4}-\d{2}$/.test(month) ? { type, format, month } : null;
    if (type === 'ANNUAL') return { type, format, year };
    if (preset !== 'custom') return { type, format, ...presetRange(preset, today) };
    return custom.from && custom.to && custom.from <= custom.to
      ? { type, format, from: custom.from, to: custom.to }
      : null;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = request();
    setInvalid(body === null);
    if (body) generate.mutate(body);
  };

  const errorCode = apiErrorOf(generate.error)?.code;
  const errorKey = `reports.error.${errorCode ?? 'generic'}`;
  const years = Array.from(
    { length: 6 },
    (_, index) => Number(today.slice(0, 4)) - index,
  );
  const range =
    type === 'MONTHLY'
      ? monthRange(month)
      : type === 'ANNUAL'
        ? { from: `${year}-01-01`, to: `${year}-12-31` }
        : preset !== 'custom'
          ? presetRange(preset, today)
          : null;

  return (
    <div className="reports">
      <header className="dashboard-header">
        <div>
          <h1>{t('reports.title')}</h1>
          <p className="hint">{t('reports.subtitle')}</p>
        </div>
      </header>

      <form className="report-builder" onSubmit={submit} noValidate>
        <fieldset className="report-step">
          <legend id={ids.type}>{t('reports.step.type')}</legend>
          <div className="report-types">
            {REPORT_TYPES.map((value) => (
              <label key={value} className="report-type">
                <input
                  type="radio"
                  name="report-type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                />
                <span className="report-type-name">{t(`reports.type.${value}`)}</span>
                <span className="report-type-desc">{t(`reports.desc.${value}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="report-row">
          <fieldset className="report-step">
            <legend id={ids.format}>{t('reports.step.format')}</legend>
            <div className="report-formats">
              {(['PDF', 'XLSX'] as const).map((value) => (
                <label key={value} className="report-format">
                  <input
                    type="radio"
                    name="report-format"
                    value={value}
                    checked={format === value}
                    onChange={() => setFormat(value)}
                  />
                  <FormatIcon format={value} />
                  <span>{t(`reports.format.${value}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="report-step">
            <legend id={ids.period}>{t('reports.step.period')}</legend>
            {type === 'MONTHLY' && (
              <div className="field">
                <label htmlFor={ids.month}>{t('reports.month')}</label>
                <input
                  id={ids.month}
                  type="month"
                  value={month}
                  max={today.slice(0, 7)}
                  onChange={(event) => setMonth(event.target.value)}
                />
              </div>
            )}
            {type === 'ANNUAL' && (
              <div className="field">
                <label htmlFor={ids.year}>{t('reports.year')}</label>
                <select
                  id={ids.year}
                  value={year}
                  onChange={(event) => setYear(Number(event.target.value))}
                >
                  {years.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {type !== 'MONTHLY' && type !== 'ANNUAL' && (
              <>
                <div className="segmented" role="group" aria-labelledby={ids.period}>
                  {PRESETS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={preset === value}
                      onClick={() => setPreset(value)}
                    >
                      {t(`reports.preset.${value}`)}
                    </button>
                  ))}
                </div>
                {preset === 'custom' && (
                  <div className="custom-period custom-period--flat">
                    <div className="field">
                      <label htmlFor={ids.from}>{t('reports.from')}</label>
                      <input
                        id={ids.from}
                        type="date"
                        value={custom.from}
                        aria-invalid={invalid}
                        onChange={(event) =>
                          setCustom((value) => ({ ...value, from: event.target.value }))
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={ids.to}>{t('reports.to')}</label>
                      <input
                        id={ids.to}
                        type="date"
                        value={custom.to}
                        aria-invalid={invalid}
                        onChange={(event) =>
                          setCustom((value) => ({ ...value, to: event.target.value }))
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            {range && (
              <p className="hint report-range">
                {t('reports.periodRange', {
                  from: calendarDate(range.from),
                  to: calendarDate(range.to),
                })}
              </p>
            )}
          </fieldset>
        </div>

        <div className="report-actions">
          <button type="submit" className="button-primary" disabled={generate.isPending}>
            {generate.isPending ? t('reports.generating') : t('reports.generate')}
          </button>
          {invalid && (
            <p className="form-status form-status--error" role="alert">
              {t('reports.invalidPeriod')}
            </p>
          )}
          {generate.isError && (
            <p className="form-status form-status--error" role="alert">
              {isMessageKey(errorKey) ? t(errorKey) : t('reports.error.generic')}
            </p>
          )}
        </div>
        <div aria-live="polite">
          {generate.data && (
            <motion.div
              className="report-result"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h2>{t('reports.ready')}</h2>
              <ReportLink report={generate.data} />
              <p className="hint">{t('reports.expiredNote')}</p>
            </motion.div>
          )}
        </div>
      </form>

      <section className="report-history" aria-labelledby={`${ids.type}-recent`}>
        <h2 id={`${ids.type}-recent`}>{t('reports.recent')}</h2>
        {reports.isError && (
          <p className="alert" role="alert">
            {t('reports.loadError')}
          </p>
        )}
        {reports.isSuccess && reports.data.length === 0 && (
          <p className="hint">{t('reports.none')}</p>
        )}
        {reports.isSuccess && reports.data.length > 0 && (
          <ul>
            {reports.data.map((report) => (
              <li key={report.id}>
                <FormatIcon format={report.format} />
                <div className="report-history-main">
                  <strong>{t(`reports.type.${report.type}`)}</strong>
                  <span className="hint">
                    {t('reports.periodRange', {
                      from: calendarDate(report.from),
                      to: calendarDate(report.to),
                    })}
                    {' · '}
                    {dateTime(report.createdAt)}
                  </span>
                </div>
                {report.status === 'READY' && report.downloadUrl ? (
                  <a
                    href={report.downloadUrl}
                    download={report.fileName ?? undefined}
                    className="button-secondary"
                  >
                    {t('assistant.attachment.download')}
                  </a>
                ) : (
                  <span
                    className={`report-status report-status--${report.status.toLowerCase()}`}
                  >
                    {t(`reports.status.${report.status}`)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
