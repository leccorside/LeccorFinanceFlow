import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { lazy, type ReactNode, Suspense, useEffect } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AiProvidersPage } from '../features/admin/AiProvidersPage';
import { AssistantPage } from '../features/assistant/AssistantPage';
import { VoiceOrb } from '../features/assistant/VoiceOrb';
import { LoginPage } from '../features/auth/LoginPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { useI18n } from '../i18n/context';
import { getCurrentUser, googleLoginUrl, logout } from '../services/auth';
import { getHealth } from '../services/health';
import { useApplyTheme } from './theme';

/** Charts (Recharts) load only when the dashboard is opened, not with the chat. */
const DashboardPage = lazy(async () => ({
  default: (await import('../features/dashboard/DashboardPage')).DashboardPage,
}));

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

/** Home for visitors: what the assistant does and the way in. */
function LandingPage() {
  const { t } = useI18n();
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, retry: false });

  return (
    <motion.section
      className="landing"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
    >
      <VoiceOrb state="idle" size={200} className="voice-orb--hero" />
      <span className="eyebrow">{t('landing.eyebrow')}</span>
      <h1>{t('landing.title')}</h1>
      <p>{t('landing.body')}</p>
      <a className="button-primary" href={googleLoginUrl('/')}>
        {t('login.google')}
      </a>
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

/** "/": the conversation for signed-in users, the landing for visitors. */
function HomeRoute() {
  const { t } = useI18n();
  const me = useCurrentUser();
  if (me.isPending) return <p role="status">{t('app.loading')}</p>;
  if (!me.data) return <LandingPage />;
  return <AssistantPage firstName={me.data.profile?.firstName ?? null} />;
}

/** Shortcut back to the conversation from any other page. */
function FloatingAssistant() {
  const { t } = useI18n();
  return (
    <Link to="/" className="floating-assistant" aria-label={t('assistant.floating')}>
      <VoiceOrb state="idle" size={56} />
    </Link>
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

/** UI gate only: the API enforces the ADMIN role on every /admin route. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const me = useCurrentUser();
  if (!me.data?.roles.includes('ADMIN')) {
    return (
      <p role="alert" className="alert">
        {t('admin.ai.forbidden')}
      </p>
    );
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
            <NavLink to="/" end>
              {t('nav.assistant')}
            </NavLink>
            <NavLink to="/dashboard">{t('nav.dashboard')}</NavLink>
            <NavLink to="/profile">{t('nav.profile')}</NavLink>
            {me.data.roles.includes('ADMIN') && (
              <NavLink to="/admin/ai">{t('nav.admin')}</NavLink>
            )}
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
  const { t } = useI18n();
  const me = useApplyProfileRegion();
  const signedIn = Boolean(me.data);
  useApplyTheme(signedIn);
  const { pathname } = useLocation();
  const chat = signedIn && pathname === '/';

  return (
    <div className={chat ? 'app-shell app-shell--chat' : 'app-shell'}>
      <Header />
      <main className={chat ? 'app-main app-main--chat' : 'app-main'}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <Suspense fallback={<p role="status">{t('dashboard.loading')}</p>}>
                  <DashboardPage />
                </Suspense>
              </RequireAuth>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <ProfilePage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/ai"
            element={
              <RequireAuth>
                <RequireAdmin>
                  <AiProvidersPage />
                </RequireAdmin>
              </RequireAuth>
            }
          />
          <Route path="/" element={<HomeRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {signedIn && !chat && pathname !== '/login' && <FloatingAssistant />}
    </div>
  );
}
