import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useMediaQuery } from '../features/assistant/motion';
import { getProfile, type Theme } from '../services/profile';

/**
 * Applies the profile's theme to <html data-theme>. "system" (and visitors) follow the OS;
 * every color comes from the CSS tokens of that theme.
 */
export function useApplyTheme(signedIn: boolean): void {
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: getProfile,
    enabled: signedIn,
  });
  const prefersLight = useMediaQuery('(prefers-color-scheme: light)');
  const chosen: Theme = (signedIn && profile.data?.preferences.theme) || 'system';
  const resolved = chosen === 'system' ? (prefersLight ? 'light' : 'dark') : chosen;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
}
