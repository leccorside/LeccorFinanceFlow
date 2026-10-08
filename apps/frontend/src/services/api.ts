import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

/** Error contract returned by the API for every failure. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: unknown;
  requestId: string;
  timestamp: string;
}

const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const CSRF_HEADER = 'X-CSRF-Token';

type RetriableConfig = InternalAxiosRequestConfig & {
  _refreshed?: boolean;
  _csrfRetried?: boolean;
};

export function apiErrorOf(error: unknown): ApiErrorBody | null {
  if (
    error instanceof AxiosError &&
    error.response?.data &&
    typeof error.response.data === 'object'
  ) {
    const data = error.response.data as Partial<ApiErrorBody>;
    return typeof data.code === 'string' ? (data as ApiErrorBody) : null;
  }
  return null;
}

/**
 * Same-origin API client (Vite proxies /api). Session cookies are HttpOnly, so the
 * client never sees tokens; it only:
 * - adds X-CSRF-Token (kept in memory, fetched from /auth/csrf) to state-changing requests;
 * - on 401, tries POST /auth/refresh once and replays the request;
 * - on 403 csrf_failed, refetches the CSRF token once and replays the request.
 */
export function createApiClient(): AxiosInstance & { resetSession: () => void } {
  const client = axios.create({ baseURL: '/api/v1', withCredentials: true });
  let csrfToken: string | null = null;
  let refreshing: Promise<boolean> | null = null;

  async function getCsrfToken(): Promise<string | null> {
    if (csrfToken) return csrfToken;
    try {
      const response = await client.get<{ csrfToken: string }>('/auth/csrf');
      csrfToken = response.data.csrfToken;
    } catch {
      csrfToken = null; // anonymous: public writes (logout/refresh) need no token
    }
    return csrfToken;
  }

  function refreshSession(): Promise<boolean> {
    refreshing ??= client
      .post('/auth/refresh')
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  client.interceptors.request.use(async (config) => {
    const method = (config.method ?? 'get').toLowerCase();
    const isAuthCall = config.url?.startsWith('/auth/');
    if (UNSAFE_METHODS.has(method) && !isAuthCall) {
      const token = await getCsrfToken();
      if (token) config.headers.set(CSRF_HEADER, token);
    }
    return config;
  });

  client.interceptors.response.use(undefined, async (error: unknown) => {
    if (!(error instanceof AxiosError) || !error.config) throw error;
    const config = error.config as RetriableConfig;
    const status = error.response?.status;
    const code = apiErrorOf(error)?.code;
    const isAuthCall = config.url?.startsWith('/auth/');

    if (status === 401 && !isAuthCall && !config._refreshed) {
      config._refreshed = true;
      if (await refreshSession()) {
        csrfToken = null; // stays the same per session, but re-read after any session change
        return client.request(config);
      }
    }

    if (status === 403 && code === 'csrf_failed' && !config._csrfRetried) {
      config._csrfRetried = true;
      csrfToken = null;
      config.headers.delete(CSRF_HEADER);
      return client.request(config);
    }

    throw error;
  });

  return Object.assign(client, {
    resetSession: () => {
      csrfToken = null;
    },
  });
}

export const api = createApiClient();
