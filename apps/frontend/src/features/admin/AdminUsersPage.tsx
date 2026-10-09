import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { isMessageKey } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import {
  type AdminUser,
  listUsers,
  setUserAdmin,
  setUserStatus,
  type UserQuery,
} from '../../services/admin';
import { apiErrorOf } from '../../services/api';

type Action = 'block' | 'unblock' | 'promote' | 'demote';
const PAGE_SIZE = 20;

function actionsFor(user: AdminUser): Action[] {
  if (user.isSelf) return [];
  const admin = user.roles.includes('ADMIN');
  const actions: Action[] = [user.status === 'ACTIVE' ? 'block' : 'unblock'];
  if (!admin && user.status === 'ACTIVE') actions.push('promote');
  if (admin && !user.adminFromEnvironment) actions.push('demote');
  return actions;
}

/**
 * Users, status and the admin role. Every change asks for confirmation; the API enforces
 * the rules (never yourself, never without an active admin, ADMIN_EMAILS stays admin).
 */
export function AdminUsersPage() {
  const { t, dateTime } = useI18n();
  const queryClient = useQueryClient();
  const ids = { search: useId(), status: useId(), role: useId(), title: useId() };
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState<UserQuery>({ page: 1, pageSize: PAGE_SIZE });
  const [pending, setPending] = useState<{ user: AdminUser; action: Action } | null>(
    null,
  );
  const [notice, setNotice] = useState('');

  const users = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: () => listUsers(query),
    placeholderData: keepPreviousData,
  });

  const change = useMutation({
    mutationFn: ({ user, action }: { user: AdminUser; action: Action }) =>
      action === 'block' || action === 'unblock'
        ? setUserStatus(user.id, action === 'block' ? 'BLOCKED' : 'ACTIVE')
        : setUserAdmin(user.id, action === 'promote'),
    onSuccess: (user) => {
      setPending(null);
      setNotice(t('admin.users.done', { email: user.email }));
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const errorCode = apiErrorOf(change.error)?.code;
  const errorKey = `admin.users.error.${errorCode ?? 'unknown'}`;
  const pages = Math.max(1, Math.ceil((users.data?.total ?? 0) / PAGE_SIZE));

  const search = (event: FormEvent) => {
    event.preventDefault();
    setQuery((current) => ({ ...current, q: draft.trim() || undefined, page: 1 }));
  };

  return (
    <div className="admin-page">
      <header className="page-header">
        <h1 id={ids.title}>{t('admin.users.title')}</h1>
      </header>

      <form className="admin-filters" onSubmit={search} role="search">
        <div className="field">
          <label htmlFor={ids.search}>{t('admin.users.search')}</label>
          <input
            id={ids.search}
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.status}>{t('admin.users.status')}</label>
          <select
            id={ids.status}
            value={query.status ?? ''}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                status: (event.target.value || undefined) as UserQuery['status'],
                page: 1,
              }))
            }
          >
            <option value="">{t('admin.users.all')}</option>
            <option value="ACTIVE">{t('admin.users.status.ACTIVE')}</option>
            <option value="BLOCKED">{t('admin.users.status.BLOCKED')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.role}>{t('admin.users.role')}</label>
          <select
            id={ids.role}
            value={query.role ?? ''}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                role: (event.target.value || undefined) as UserQuery['role'],
                page: 1,
              }))
            }
          >
            <option value="">{t('admin.users.all')}</option>
            <option value="ADMIN">{t('admin.users.role.ADMIN')}</option>
            <option value="USER">{t('admin.users.role.USER')}</option>
          </select>
        </div>
        <button type="submit" className="button-secondary">
          {t('admin.users.searchButton')}
        </button>
      </form>

      <div aria-live="polite" className="visually-hidden">
        {notice}
      </div>
      {notice && <p className="notice">{notice}</p>}
      {change.isError && (
        <p className="alert" role="alert">
          {isMessageKey(errorKey) ? t(errorKey) : t('admin.users.error.unknown')}
        </p>
      )}

      {users.isError && (
        <p className="alert" role="alert">
          {t('admin.loadError')}
        </p>
      )}
      {users.data && users.data.items.length === 0 && (
        <p className="hint">{t('admin.users.empty')}</p>
      )}
      {users.data && users.data.items.length > 0 && (
        <ul className="admin-users" aria-labelledby={ids.title}>
          {users.data.items.map((user) => {
            const confirming = pending?.user.id === user.id ? pending.action : null;
            return (
              <li
                key={user.id}
                className={
                  user.status === 'BLOCKED'
                    ? 'admin-user admin-user--blocked'
                    : 'admin-user'
                }
              >
                <div className="admin-user-main">
                  <strong>{user.name ?? user.email}</strong>
                  {user.name && <span className="hint">{user.email}</span>}
                  <div className="admin-badges">
                    {user.roles.includes('ADMIN') && (
                      <span className="badge badge--admin">
                        {t('admin.users.role.ADMIN')}
                      </span>
                    )}
                    <span
                      className={
                        user.status === 'ACTIVE' ? 'badge badge--on' : 'badge badge--off'
                      }
                    >
                      {t(`admin.users.status.${user.status}`)}
                    </span>
                    {user.adminFromEnvironment && (
                      <span className="badge">{t('admin.users.envAdmin')}</span>
                    )}
                    {user.isSelf && <span className="badge">{t('admin.users.you')}</span>}
                  </div>
                  <span className="hint admin-user-meta">
                    {user.googleConnection === 'ACTIVE'
                      ? `${t('admin.users.google')} · `
                      : ''}
                    {t('admin.users.sheets', { count: user.spreadsheets })} ·{' '}
                    {user.lastLoginAt
                      ? t('admin.users.lastLogin', { time: dateTime(user.lastLoginAt) })
                      : t('admin.users.never')}
                  </span>
                </div>
                <div className="admin-user-actions">
                  {confirming ? (
                    <div
                      className="confirm-box"
                      role="group"
                      aria-label={t(`admin.users.confirm.${confirming}`, {
                        email: user.email,
                      })}
                    >
                      <p>
                        {t(`admin.users.confirm.${confirming}`, { email: user.email })}
                      </p>
                      <div className="form-actions">
                        <button
                          type="button"
                          className={
                            confirming === 'block' || confirming === 'demote'
                              ? 'button-danger'
                              : 'button-secondary'
                          }
                          disabled={change.isPending}
                          onClick={() => change.mutate({ user, action: confirming })}
                        >
                          {t('admin.users.confirm.yes')}
                        </button>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => setPending(null)}
                        >
                          {t('admin.users.confirm.no')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    actionsFor(user).map((action) => (
                      <button
                        key={action}
                        type="button"
                        className="button-secondary"
                        aria-label={`${t(`admin.users.${action}`)}: ${user.email}`}
                        onClick={() => {
                          change.reset();
                          setNotice('');
                          setPending({ user, action });
                        }}
                      >
                        {t(`admin.users.${action}`)}
                      </button>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {users.data && users.data.total > PAGE_SIZE && (
        <nav className="admin-pager" aria-label={t('admin.users.title')}>
          <button
            type="button"
            className="button-secondary"
            disabled={query.page <= 1}
            onClick={() =>
              setQuery((current) => ({ ...current, page: current.page - 1 }))
            }
          >
            {t('admin.users.prev')}
          </button>
          <span>
            {t('admin.users.page', { page: query.page, pages, total: users.data.total })}
          </span>
          <button
            type="button"
            className="button-secondary"
            disabled={query.page >= pages}
            onClick={() =>
              setQuery((current) => ({ ...current, page: current.page + 1 }))
            }
          >
            {t('admin.users.next')}
          </button>
        </nav>
      )}
    </div>
  );
}
