import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { getProfile, type Profile } from '../services/profile';
import { useApplyTheme } from './theme';

vi.mock('../services/profile', () => ({ getProfile: vi.fn() }));

function Probe({ signedIn }: { signedIn: boolean }) {
  useApplyTheme(signedIn);
  return null;
}

function renderProbe(signedIn: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Probe signedIn={signedIn} />
    </QueryClientProvider>,
  );
}

function osPrefersLight(light: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: light && query === '(prefers-color-scheme: light)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

describe('theme', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
    delete document.documentElement.dataset.theme;
  });

  it('follows the OS for visitors', () => {
    osPrefersLight(true);
    renderProbe(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("applies the profile's explicit theme over the OS", async () => {
    osPrefersLight(true);
    vi.mocked(getProfile).mockResolvedValue({
      preferences: { theme: 'dark', weekStartsOn: 'monday', confirmSimpleDeletes: true },
    } as Profile);
    renderProbe(true);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });
});
