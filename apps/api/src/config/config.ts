import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().default('postgres://relay:relay@localhost:5432/relay_desk'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** 32-byte key, base64. Encrypts secrets at rest (TOTP secrets, later mailbox credentials). */
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64')
    .default('ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM='),
  /** Set true behind TLS so cookies get the Secure flag. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(120),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Public base URL of the app, e.g. https://helpdesk.ricoman.com (used for Google sign-in redirects). */
  PUBLIC_URL: z.string().default('http://localhost:5173'),
  /** Google OAuth client for the Gmail API (owner O-2, O-10). */
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  /** Where raw emails and attachments are stored on disk. */
  STORAGE_DIR: z.string().default('./data/storage'),
  /** How often each mailbox is checked for new mail. */
  MAIL_POLL_SECONDS: z.coerce.number().int().min(15).default(60),
  /** "SLA about to breach" notice, in working minutes before the deadline (spec 13). */
  SLA_WARNING_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = schema.parse(env);
  if (config.NODE_ENV === 'production' && config.ENCRYPTION_KEY === 'ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM=') {
    throw new Error('ENCRYPTION_KEY must be set in production');
  }
  return config;
}

export const CONFIG = Symbol('CONFIG');
