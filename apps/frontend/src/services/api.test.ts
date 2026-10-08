import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { createApiClient } from './api';

interface Call {
  method: string;
  url: string;
  csrf: string | undefined;
}

/** Scripted fake transport: each handler returns [status, body]. */
function fakeAdapter(handler: (call: Call, index: number) => [number, unknown]) {
  const calls: Call[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const call: Call = {
      method: (config.method ?? 'get').toUpperCase(),
      url: config.url ?? '',
      csrf: config.headers.get('X-CSRF-Token') as string | undefined,
    };
    calls.push(call);
    const [status, data] = handler(call, calls.length - 1);
    const response: AxiosResponse = { status, statusText: '', data, headers: {}, config };
    if (status >= 400) {
      throw new AxiosError('failed', String(status), config, null, response);
    }
    return response;
  };
  return { adapter, calls };
}

function client(handler: Parameters<typeof fakeAdapter>[0]) {
  const api = createApiClient();
  const fake = fakeAdapter(handler);
  api.defaults.adapter = fake.adapter;
  return { api, calls: fake.calls };
}

describe('api client', () => {
  it('sends the session CSRF token on writes, fetching it once', async () => {
    const { api, calls } = client((call) =>
      call.url === '/auth/csrf' ? [200, { csrfToken: 'token-1' }] : [200, {}],
    );

    await api.patch('/profile', { firstName: 'Ana' });
    await api.post('/something', {});
    await api.get('/profile');

    expect(calls.map((call) => `${call.method} ${call.url} ${call.csrf ?? '-'}`)).toEqual(
      [
        'GET /auth/csrf -',
        'PATCH /profile token-1',
        'POST /something token-1',
        'GET /profile -',
      ],
    );
  });

  it('refreshes the session once on 401 and replays the request', async () => {
    let refreshed = false;
    const { api, calls } = client((call) => {
      if (call.url === '/auth/refresh') {
        refreshed = true;
        return [204, null];
      }
      return refreshed ? [200, { ok: true }] : [401, { code: 'unauthenticated' }];
    });

    const response = await api.get('/profile');

    expect(response.data).toEqual({ ok: true });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /profile',
      'POST /auth/refresh',
      'GET /profile',
    ]);
  });

  it('gives up after a failed refresh (no loop)', async () => {
    const { api, calls } = client((call) =>
      call.url === '/auth/refresh'
        ? [401, { code: 'invalid_session' }]
        : [401, { code: 'unauthenticated' }],
    );

    await expect(api.get('/profile')).rejects.toBeInstanceOf(AxiosError);
    expect(calls).toHaveLength(2);
  });

  it('refetches the CSRF token once after csrf_failed', async () => {
    let csrfCalls = 0;
    const { api, calls } = client((call) => {
      if (call.url === '/auth/csrf') {
        csrfCalls += 1;
        return [200, { csrfToken: `token-${csrfCalls}` }];
      }
      return call.csrf === 'token-2' ? [200, {}] : [403, { code: 'csrf_failed' }];
    });

    await api.patch('/profile', {});

    expect(calls.map((call) => `${call.method} ${call.url} ${call.csrf ?? '-'}`)).toEqual(
      [
        'GET /auth/csrf -',
        'PATCH /profile token-1',
        'GET /auth/csrf -',
        'PATCH /profile token-2',
      ],
    );
  });
});
