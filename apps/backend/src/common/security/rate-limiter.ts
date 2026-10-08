export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets (for Retry-After). */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter kept in process memory. No Redis/queue by design: limits are
 * per backend instance (a single instance in this architecture) and reset on restart.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private lastSweep: number;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sweepEveryMs = 60_000,
  ) {
    this.lastSweep = now();
  }

  hit(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = this.now();
    this.sweep(now);

    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }

    window.count += 1;
    return {
      allowed: window.count <= limit,
      limit,
      remaining: Math.max(0, limit - window.count),
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }

  /** Number of tracked keys (for tests). */
  get size(): number {
    return this.windows.size;
  }

  /** Drops expired windows so memory stays bounded by active clients. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.sweepEveryMs) {
      return;
    }
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
