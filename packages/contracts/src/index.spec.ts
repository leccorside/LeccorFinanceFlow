import type { HealthContract } from './index.js';
import { describe, expect, it } from 'vitest';

describe('HealthContract', () => {
  it('accepts the canonical healthy response', () => {
    const response = {
      status: 'ok',
      service: 'leccor-finance-flow-api',
    } satisfies HealthContract;

    expect(response.status).toBe('ok');
  });
});
