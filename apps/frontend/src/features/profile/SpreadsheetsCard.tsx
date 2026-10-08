import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../i18n/context';
import { apiErrorOf } from '../../services/api';
import { getGoogleConnection } from '../../services/google';
import { createSpreadsheet, listSpreadsheets } from '../../services/spreadsheets';
import { spreadsheetErrorKey } from './spreadsheet-errors';

export function SpreadsheetsCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const sheets = useQuery({ queryKey: ['spreadsheets'], queryFn: listSpreadsheets });
  const connection = useQuery({
    queryKey: ['google-connection'],
    queryFn: getGoogleConnection,
  });

  const create = useMutation({
    mutationFn: () => createSpreadsheet(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['spreadsheets'] });
      void queryClient.invalidateQueries({ queryKey: ['google-connection'] });
    },
  });

  const connected = connection.data?.status === 'ACTIVE';
  const hasReady = sheets.data?.some((sheet) => sheet.status === 'ACTIVE') ?? false;
  const failure = create.isError
    ? spreadsheetErrorKey(apiErrorOf(create.error)?.code)
    : null;

  return (
    <section className="card" aria-labelledby="sheets-title">
      <h2 id="sheets-title">{t('sheets.title')}</h2>
      <p>{t('sheets.description')}</p>

      {sheets.isPending && <p role="status">{t('app.loading')}</p>}
      {sheets.isError && <p role="alert">{t('sheets.error.load')}</p>}

      {sheets.data && sheets.data.length === 0 && <p>{t('sheets.empty')}</p>}
      {sheets.data && sheets.data.length > 0 && (
        <ul className="sheet-list">
          {sheets.data.map((sheet) => (
            <li key={sheet.id}>
              <span className="sheet-name">{sheet.name}</span>
              <span className="sheet-status" data-status={sheet.status}>
                {t(`sheets.status.${sheet.status}`)}
                {sheet.isActive && ` · ${t('sheets.active')}`}
              </span>
              {sheet.url && sheet.status === 'ACTIVE' && (
                <a href={sheet.url} target="_blank" rel="noopener noreferrer">
                  {t('sheets.open')}
                </a>
              )}
              {sheet.status === 'ERROR' && (
                <small>{t(spreadsheetErrorKey(sheet.lastErrorCode))}</small>
              )}
            </li>
          ))}
        </ul>
      )}

      {!connected && connection.isSuccess && (
        <p id="sheets-needs-google" className="notice">
          {t('sheets.needsGoogle')}
        </p>
      )}

      {!hasReady && (
        <button
          type="button"
          className="button-primary"
          disabled={!connected || create.isPending}
          aria-describedby={connected ? undefined : 'sheets-needs-google'}
          onClick={() => create.mutate()}
        >
          {create.isPending ? t('sheets.creating') : t('sheets.create')}
        </button>
      )}

      {create.isSuccess && (
        <p role="status" className="notice">
          {t('sheets.created')}
        </p>
      )}
      {failure && (
        <p role="alert" className="alert">
          {t(failure)}
        </p>
      )}
    </section>
  );
}
