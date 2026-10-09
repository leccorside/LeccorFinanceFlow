import { render } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { synthesizeLevels } from './orb-signal';
import { VoiceOrb } from './VoiceOrb';

function energy(state: Parameters<typeof synthesizeLevels>[0]): number {
  const levels = new Float32Array(72);
  let total = 0;
  // Average over two seconds of animation.
  for (let t = 0; t < 2; t += 0.05) {
    synthesizeLevels(state, t, levels);
    total += levels.reduce((sum, level) => sum + level, 0) / levels.length;
  }
  return total / 40;
}

function fakeContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
    createLinearGradient: vi.fn(() => gradient),
  };
}

function mockReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

describe('voice orb', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('keeps every bar between 0 and 1 and is loudest while speaking', () => {
    const levels = new Float32Array(72);
    for (const state of ['idle', 'listening', 'thinking', 'speaking', 'error'] as const) {
      for (let t = 0; t < 3; t += 0.1) {
        synthesizeLevels(state, t, levels);
        expect(Math.min(...levels)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...levels)).toBeLessThanOrEqual(1);
      }
    }
    expect(energy('speaking')).toBeGreaterThan(energy('idle') * 2);
    expect(energy('speaking')).toBeGreaterThan(energy('thinking'));
    expect(energy('error')).toBeLessThan(energy('idle'));
  });

  it('is decorative, exposes its state and survives a browser without canvas', () => {
    const { container, rerender } = render(<VoiceOrb state="idle" size={80} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(canvas).toHaveStyle({ width: '80px', height: '80px' });

    rerender(<VoiceOrb state="speaking" size={80} />);
    expect(canvas).toHaveAttribute('data-state', 'speaking');
  });

  it('animates the frequency ring frame by frame and stops on unmount', () => {
    const ctx = fakeContext();
    HTMLCanvasElement.prototype.getContext = (() =>
      ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    mockReducedMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const { unmount } = render(<VoiceOrb state="speaking" size={100} />);
    frames.shift()?.(16);
    frames.shift()?.(32);

    // 72 bars per frame, two frames, plus a new frame requested each time.
    expect(ctx.stroke).toHaveBeenCalledTimes(144);
    expect(frames).toHaveLength(1);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it('draws a single still frame when the user prefers reduced motion', () => {
    const ctx = fakeContext();
    HTMLCanvasElement.prototype.getContext = (() =>
      ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    mockReducedMotion(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame');

    const { rerender } = render(<VoiceOrb state="idle" size={100} />);
    expect(ctx.stroke).toHaveBeenCalledTimes(72);

    rerender(<VoiceOrb state="speaking" size={100} />);
    expect(ctx.stroke).toHaveBeenCalledTimes(144);
    expect(raf).not.toHaveBeenCalled();
  });
});
