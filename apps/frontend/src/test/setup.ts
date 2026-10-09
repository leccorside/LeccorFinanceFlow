import '@testing-library/jest-dom/vitest';

// jsdom has no canvas: the voice orb then skips drawing (as it would without canvas support).
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom has no layout: Recharts' ResponsiveContainer needs ResizeObserver to exist. With
// no size it draws nothing, so tests read the accessible summaries and tables instead.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
