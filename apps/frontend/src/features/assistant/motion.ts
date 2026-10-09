import { useEffect, useState } from 'react';

/** Follows the OS "reduce motion" setting live. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * Reveals `text` progressively (a few characters per frame). Returns the visible part and
 * whether it is still writing; with reduced motion, or when `enabled` is false, the full
 * text appears at once.
 */
export function useTypewriter(
  text: string,
  enabled: boolean,
  onDone?: () => void,
): { visible: string; writing: boolean } {
  const reduced = usePrefersReducedMotion();
  const animate = enabled && !reduced;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    let shown = 0;
    // ~60 chars/s for short answers, faster for long ones (max ~4 s).
    const perFrame = Math.max(1, Math.ceil(text.length / 240));
    const tick = () => {
      shown = Math.min(text.length, shown + perFrame);
      setCount(shown);
      if (shown < text.length) frame = requestAnimationFrame(tick);
      else onDone?.();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // onDone is a notification; restarting the animation when it changes would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate]);

  if (!animate) return { visible: text, writing: false };
  return { visible: text.slice(0, count), writing: count < text.length };
}

/** Live result of a CSS media query (false where matchMedia is unavailable). */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const onChange = () => setMatch(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return match;
}
