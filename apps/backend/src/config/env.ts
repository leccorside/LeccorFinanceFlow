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

const httpUrl = z.string().refine((value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, 'must be an http(s) URL');

const DURATION_UNITS_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Parses "90s", "15m", "12h" or "30d" into milliseconds. */
export function parseDurationMs(value: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof DURATION_UNITS_MS;
  return amount > 0 ? amount * DURATION_UNITS_MS[unit] : null;
}

const duration = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value, ctx) => {
      const ms = parseDurationMs(value);
      if (ms === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'must be a duration like 15m, 12h or 30d',
        });
        return z.NEVER;
      }
      return ms;
    });

const optionalNonEmpty = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

/** Comma-separated list; blanks ignored. */
const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  );

const originList = csv
  .pipe(z.array(httpUrl))
  .transform((urls) => urls.map((url) => new URL(url).origin));

const emailList = csv
  .transform((emails) => emails.map((email) => email.toLowerCase()))
  .pipe(z.array(z.email()));

const positiveInt = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

/** Express "trust proxy": false (default), true, a hop count or a list such as "loopback, uniquelocal". */
const trustProxy = z
  .string()
  .optional()
  .transform((value): boolean | number | string => {
    const trimmed = value?.trim() ?? '';
    if (trimmed === '' || trimmed === 'false') return false;
    if (trimmed === 'true') return true;
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: postgresUrl,
    FRONTEND_URL: httpUrl.default('http://localhost:5173'),
    ACCESS_TOKEN_TTL: duration('15m'),
    REFRESH_TOKEN_TTL: duration('30d'),
    /** Defaults to true in production. Browsers accept Secure cookies on http://localhost. */
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    GOOGLE_CLIENT_ID: optionalNonEmpty,
    GOOGLE_CLIENT_SECRET: optionalNonEmpty,
    /** Must match a redirect URI registered in Google Cloud; through the frontend origin by default. */
    GOOGLE_REDIRECT_URI: optionalNonEmpty.pipe(
      httpUrl.default('http://localhost:5173/api/v1/auth/google/callback'),
    ),
    /** Extra browser origins allowed by CORS and the CSRF origin check (FRONTEND_URL always is). */
    CORS_ALLOWED_ORIGINS: originList,
    RATE_LIMIT_TTL_SECONDS: positiveInt(60, 86_400),
    /** Per client IP and window, across the whole API. */
    RATE_LIMIT_MAX_REQUESTS: positiveInt(100, 1_000_000),
    /** Per client IP and window, on /auth routes (login, callback, refresh, logout, csrf). */
    AUTH_RATE_LIMIT_MAX_REQUESTS: positiveInt(20, 1_000_000),
    MAX_JSON_BODY_SIZE: z
      .string()
      .regex(/^\d+(b|kb|mb)$/i, 'must look like 512kb or 1mb')
      .default('1mb'),
    TRUST_PROXY: trustProxy,
    /** Users whose verified Google e-mail is listed receive the ADMIN role on login. */
    ADMIN_EMAILS: emailList,
  })
  .superRefine((env, ctx) => {
    // Client ID and secret decide whether Google login is enabled; both or neither.
    if (
      (env.GOOGLE_CLIENT_ID === undefined) !==
      (env.GOOGLE_CLIENT_SECRET === undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
      });
    }
    if (env.REFRESH_TOKEN_TTL <= env.ACCESS_TOKEN_TTL) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_TTL'],
        message: 'must be longer than ACCESS_TOKEN_TTL',
      });
    }
  })
  .transform(
    ({
      COOKIE_SECURE,
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI,
      CORS_ALLOWED_ORIGINS,
      ...env
    }) => ({
      ...env,
      /** FRONTEND_URL origin + CORS_ALLOWED_ORIGINS, deduplicated. */
      ALLOWED_ORIGINS: [
        ...new Set([new URL(env.FRONTEND_URL).origin, ...CORS_ALLOWED_ORIGINS]),
      ],
      COOKIE_SECURE:
        COOKIE_SECURE === undefined
          ? env.NODE_ENV === 'production'
          : COOKIE_SECURE === 'true',
      GOOGLE_OAUTH:
        GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
          ? {
              clientId: GOOGLE_CLIENT_ID,
              clientSecret: GOOGLE_CLIENT_SECRET,
              redirectUri: GOOGLE_REDIRECT_URI,
            }
          : null,
    }),
  );

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
