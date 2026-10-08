import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { type ReactNode, useEffect } from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { useI18n } from '../i18n/context';
import { getCurrentUser, logout } from '../services/auth';
import { getHealth } from '../services/health';

function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 60_000,
  });
}

/** After login, the profile's language, currency and time zone drive the whole UI. */
function useApplyProfileRegion() {
  const { setRegional } = useI18n();
  const me = useCurrentUser();
  const profile = me.data?.profile;
  useEffect(() => {
    if (profile) {
      setRegional({
        locale: profile.locale,
        currency: profile.currency,
        timeZone: profile.timeZone,
      });
    }
  }, [profile, setRegional]);
  return me;
}

function FoundationPage() {
  const { t } = useI18n();
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, retry: false });

  return (
    <motion.section
      className="foundation-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <span className="eyebrow">LECCOR FINANCE FLOW</span>
      <h1>{t('home.title')}</h1>
      <p>{t('home.body')}</p>
      <div className="status-row" aria-live="polite">
        <span
          className={health.isSuccess ? 'status-dot status-dot--online' : 'status-dot'}
          aria-hidden="true"
        />
        {health.isSuccess ? t('home.apiOnline') : t('home.apiWaiting')}
      </div>
    </motion.section>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const me = useCurrentUser();
  const location = useLocation();

  if (me.isPending) {
    return <p role="status">{t('app.loading')}</p>;
  }
  if (!me.data) {
    const redirectTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirectTo=${redirectTo}`} replace />;
  }
  return children;
}

function Header() {
  const { t } = useI18n();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      queryClient.clear();
      void navigate('/login');
    },
  });

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        {t('app.name')}
      </Link>
      <nav aria-label={t('nav.main')}>
        {me.data ? (
          <>
            <Link to="/profile">{t('nav.profile')}</Link>
            <button
              type="button"
              className="link-button"
              onClick={() => signOut.mutate()}
            >
              {t('nav.logout')}
            </button>
          </>
        ) : (
          <Link to="/login">{t('nav.login')}</Link>
        )}
      </nav>
    </header>
  );
}

export function App() {
  useApplyProfileRegion();

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<FoundationPage />} />
        </Routes>
      </main>
    </div>
  );
}
