import '@testing-library/jest-dom/vitest';

// jsdom has no canvas: the voice orb then skips drawing (as it would without canvas support).
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;
