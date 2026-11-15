import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

// Validate environment variables once at startup, so a missing or weak secret
// crashes the app immediately instead of failing later at runtime.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  MONGO_URL: z.string().min(1, 'MONGO_URL is required'),
  APP_URL: z.url().default('http://localhost:4100'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Background jobs
  RUN_WORKER: bool.default(true),
  JOBS_PROCESS_EVERY_MS: z.coerce.number().int().min(50).default(5000),
  CHECK_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(20),

  // Checks
  CHECK_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  CHECK_RETRY_BASE_MS: z.coerce.number().int().min(0).default(2000),
  CHECKS_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  MAX_MONITORS_PER_USER: z.coerce.number().int().min(1).default(50),
  // Lets you monitor localhost / private IPs. Keep false in production (SSRF).
  ALLOW_PRIVATE_TARGETS: bool.default(false),

  // Email alerts
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Uptime Monitor <alerts@uptime.local>'),
  ALERT_RETRY_BASE_MS: z.coerce.number().int().min(0).default(30_000),
  ALERT_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(5),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment variables:\n${problems}\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigin =
  env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
