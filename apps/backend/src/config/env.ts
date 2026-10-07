import { z } from 'zod';

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname.length > 0
      );
    } catch {
      return false;
    }
  }, 'must be a postgres:// or postgresql:// URL with a host');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: postgresUrl,
});

export type AppEnv = z.infer<typeof envSchema>;

export const APP_ENV = Symbol('APP_ENV');

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates the environment and returns a typed, frozen configuration.
 * Error messages name the variable and the rule, never the received value,
 * so secrets are not echoed back.
 */
export function loadEnv(source: Record<string, string | undefined>): Readonly<AppEnv> {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    );
  }

  return Object.freeze(result.data);
}
