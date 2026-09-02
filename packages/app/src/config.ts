import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  POLL_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(45),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_CHAT_ID: z.string().optional().default(''),
  AI_PROVIDER: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default('gpt-4o-mini'),
  JOBVISION_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? true : v === 'true' || v === '1')),
  IRANTALENT_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? true : v === 'true' || v === '1')),
  LINKEDIN_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? false : v === 'true' || v === '1')),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

/** Feature toggles derived from configuration. */
export interface AppConfig extends Env {
  telegramEnabled: boolean;
  aiEnabled: boolean;
}

export function appConfig(env: Env = loadEnv()): AppConfig {
  return {
    ...env,
    telegramEnabled: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    aiEnabled: Boolean(env.AI_PROVIDER && env.OPENAI_API_KEY),
  };
}
