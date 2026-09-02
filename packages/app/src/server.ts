import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { createLogger } from './logger.js';
import { loadEnv, appConfig } from './config.js';

/**
 * Build the Fastify application. Exported as a factory that avoids the
 * loggerInstance generic-inference pitfall by typing the instance explicitly.
 */
export function buildApp(
  opts: { logger?: Logger; env?: ReturnType<typeof loadEnv> } = {},
): FastifyInstance {
  const env = opts.env ?? loadEnv();
  const config = appConfig(env);
  const logger = opts.logger ?? createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  const app = Fastify({
    loggerInstance: logger as never,
    disableRequestLogging: env.NODE_ENV === 'test',
  });

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? '0.1.0',
    features: {
      telegram: config.telegramEnabled,
      ai: config.aiEnabled,
      jobvision: config.JOBVISION_ENABLED,
      irantalent: config.IRANTALENT_ENABLED,
      linkedin: config.LINKEDIN_ENABLED,
    },
    timestamp: new Date().toISOString(),
  }));

  return app as unknown as FastifyInstance;
}

export async function buildServer(opts: { logger?: Logger } = {}): Promise<FastifyInstance> {
  return buildApp(opts);
}

export async function startServer(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = await buildServer();
  const port: number = env.PORT;
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
