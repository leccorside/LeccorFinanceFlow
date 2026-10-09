import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useI18n } from '../../i18n/context';
import { AdminOverviewPage } from './AdminOverviewPage';
import { AdminSettingsPage } from './AdminSettingsPage';
import { AdminUsersPage } from './AdminUsersPage';
import { AiProvidersPage } from './AiProvidersPage';

/** The administration area (lazy chunk): tabs + nested routes. ADMIN is enforced by the API. */
export function AdminRoutes() {
  const { t } = useI18n();
  const tabs: [string, string][] = [
    ['', t('admin.tab.overview')],
    ['users', t('admin.tab.users')],
    ['ai', t('admin.tab.ai')],
    ['settings', t('admin.tab.settings')],
  ];
  return (
    <div className="admin-shell">
      <nav className="admin-tabs" aria-label={t('admin.nav')}>
        {tabs.map(([path, label]) => (
          <NavLink key={path} to={`/admin${path ? `/${path}` : ''}`} end={path === ''}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<AdminOverviewPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="ai" element={<AiProvidersPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </div>
  );
}
