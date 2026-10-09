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
    /** Redirect URI of the separate Drive/Sheets consent (also registered in Google Cloud). */
    GOOGLE_CONNECTION_REDIRECT_URI: optionalNonEmpty.pipe(
      httpUrl.default('http://localhost:5173/api/v1/google/callback'),
    ),
    /** Extra browser origins allowed by CORS and the CSRF origin check (FRONTEND_URL always is). */
    CORS_ALLOWED_ORIGINS: originList,
    RATE_LIMIT_TTL_SECONDS: positiveInt(60, 86_400),
    /** Per client IP and window, across the whole API. */
    RATE_LIMIT_MAX_REQUESTS: positiveInt(100, 1_000_000),
    /** Per client IP and window, on /auth routes (login, callback, refresh, logout, csrf). */
    AUTH_RATE_LIMIT_MAX_REQUESTS: positiveInt(20, 1_000_000),
    /** Per client IP and window, on spreadsheet creation/repair (several Google calls each). */
    SPREADSHEET_RATE_LIMIT_MAX_REQUESTS: positiveInt(10, 1_000_000),
    MAX_JSON_BODY_SIZE: z
      .string()
      .regex(/^\d+(b|kb|mb)$/i, 'must look like 512kb or 1mb')
      .default('1mb'),
    TRUST_PROXY: trustProxy,
    /** Users whose verified Google e-mail is listed receive the ADMIN role on login. */
    ADMIN_EMAILS: emailList,
    /** Per AI provider request; the next provider is tried after a timeout. */
    AI_REQUEST_TIMEOUT_MS: positiveInt(30_000, 300_000),
    /** Optional server-side keys, used only when a configuration has no stored key. */
    OPENAI_API_KEY: optionalNonEmpty,
    GEMINI_API_KEY: optionalNonEmpty,
    ANTHROPIC_API_KEY: optionalNonEmpty,
    /** Suggested models for new configurations in the admin screen. */
    OPENAI_DEFAULT_CHAT_MODEL: optionalNonEmpty,
    GEMINI_DEFAULT_CHAT_MODEL: optionalNonEmpty,
    ANTHROPIC_DEFAULT_CHAT_MODEL: optionalNonEmpty,
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
      GOOGLE_CONNECTION_REDIRECT_URI,
      CORS_ALLOWED_ORIGINS,
      AI_REQUEST_TIMEOUT_MS,
      OPENAI_API_KEY,
      GEMINI_API_KEY,
      ANTHROPIC_API_KEY,
      OPENAI_DEFAULT_CHAT_MODEL,
      GEMINI_DEFAULT_CHAT_MODEL,
      ANTHROPIC_DEFAULT_CHAT_MODEL,
      ...env
    }) => ({
      ...env,
      AI: {
        timeoutMs: AI_REQUEST_TIMEOUT_MS,
        environmentKeys: {
          OPENAI: OPENAI_API_KEY,
          GEMINI: GEMINI_API_KEY,
          ANTHROPIC: ANTHROPIC_API_KEY,
        } as Record<'OPENAI' | 'GEMINI' | 'ANTHROPIC', string | undefined>,
        defaultModels: {
          OPENAI: OPENAI_DEFAULT_CHAT_MODEL,
          GEMINI: GEMINI_DEFAULT_CHAT_MODEL,
          ANTHROPIC: ANTHROPIC_DEFAULT_CHAT_MODEL,
        } as Record<'OPENAI' | 'GEMINI' | 'ANTHROPIC', string | undefined>,
      },
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
              connectionRedirectUri: GOOGLE_CONNECTION_REDIRECT_URI,
            }
          : null,
    }),
  );

export interface EncryptionConfig {
  activeVersion: string;
  /** version ("v1", "v2"…) → 32-byte AES key. */
  keys: ReadonlyMap<string, Buffer>;
}

export type AppEnv = z.infer<typeof envSchema> & {
  /** Null when no DATA_ENCRYPTION_KEY_V<n> is set: features storing secrets answer 503. */
  ENCRYPTION: EncryptionConfig | null;
};

const KEY_VARIABLE = /^DATA_ENCRYPTION_KEY_V(\d+)$/;

/**
 * Reads DATA_ENCRYPTION_KEY_V<n> (base64 of exactly 32 bytes) and
 * DATA_ENCRYPTION_KEY_ACTIVE_VERSION. Old versions stay configured after a rotation so
 * existing ciphertexts remain readable until re-encrypted.
 */
function parseEncryption(
  source: Record<string, string | undefined>,
  issues: string[],
): EncryptionConfig | null {
  const keys = new Map<string, Buffer>();
  for (const [name, raw] of Object.entries(source)) {
    const match = KEY_VARIABLE.exec(name);
    const value = raw?.trim();
    if (!match || !value) {
      continue;
    }
    const key = /^[A-Za-z0-9+/_-]+={0,2}$/.test(value)
      ? Buffer.from(value, 'base64')
      : null;
    if (!key || key.length !== 32) {
      issues.push(`${name}: must be the base64 encoding of exactly 32 random bytes`);
      continue;
    }
    keys.set(`v${Number(match[1])}`, key);
  }

  if (keys.size === 0) {
    return null;
  }

  const requested = source.DATA_ENCRYPTION_KEY_ACTIVE_VERSION?.trim().toLowerCase();
  const activeVersion = requested || (keys.size === 1 ? [...keys.keys()][0] : undefined);
  if (!activeVersion || !keys.has(activeVersion)) {
    issues.push(
      'DATA_ENCRYPTION_KEY_ACTIVE_VERSION: must name a configured key version (e.g. v1)',
    );
    return null;
  }
  return { activeVersion, keys };
}

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
  const issues = result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      );
  const encryption = parseEncryption(source, issues);

  if (!result.success || issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  return Object.freeze({ ...result.data, ENCRYPTION: encryption });
}
