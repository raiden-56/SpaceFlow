import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(500).default(25),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  JOBS_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  REDIS_URL: z.string().optional().default(''),
  SENTRY_DSN: z.string().optional().default(''),
  /** Guest mode: visitors get a private, auto-purged sandbox organisation with demo data. */
  GUEST_MODE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  GUEST_SANDBOX_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('SpaceFlow <no-reply@spaceflow.local>'),
  OIDC_ISSUER_URL: z.string().optional().default(''),
  OIDC_CLIENT_ID: z.string().optional().default(''),
  OIDC_CLIENT_SECRET: z.string().optional().default(''),
  OIDC_REDIRECT_URI: z.string().optional().default(''),
  MS_GRAPH_TENANT_ID: z.string().optional().default(''),
  MS_GRAPH_CLIENT_ID: z.string().optional().default(''),
  MS_GRAPH_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_CALENDAR_CREDENTIALS_PATH: z.string().optional().default(''),
  SEED_ADMIN_EMAIL: z.string().optional().default('admin@spaceflow.local'),
  SEED_ADMIN_PASSWORD: z.string().optional().default('Admin123!'),
  SEED_USER_PASSWORD: z.string().optional().default('Password123!'),
});

function loadEnv() {
  const raw = { ...process.env };
  // Integration tests point Prisma at the isolated test database.
  if (raw.NODE_ENV === 'test' && raw.TEST_DATABASE_URL) {
    raw.DATABASE_URL = raw.TEST_DATABASE_URL;
  }
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.JWT_ACCESS_SECRET.startsWith('change-me') || env.JWT_REFRESH_SECRET.startsWith('change-me')) {
      // eslint-disable-next-line no-console
      console.error('Refusing to start in production with placeholder JWT secrets.');
      process.exit(1);
    }
  }
  return {
    ...env,
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    uploadDirAbs: path.resolve(process.cwd(), env.UPLOAD_DIR),
    webOrigins: env.WEB_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const env = loadEnv();
export type Env = typeof env;
