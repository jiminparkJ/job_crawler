import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { createLogger } from './logger.js';
import { loadEnv, appConfig } from './config.js';
import { SourceHealthMonitor } from './monitoring/sourceHealth.js';
import { canTransition } from './personalization/engine.js';

export interface BuildAppOptions {
  logger?: Logger;
  env?: ReturnType<typeof loadEnv>;
  prisma?: PrismaClient;
}

/**
 * Build the Fastify application: health + ops endpoints.
 * The worker (scheduler) runs alongside; see pipeline/startWorker.ts.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<{
  app: FastifyInstance;
  prisma: PrismaClient;
}> {
  const env = opts.env ?? loadEnv();
  const config = appConfig(env);
  const logger = opts.logger ?? createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
  const prisma = opts.prisma ?? new PrismaClient();

  const app = Fastify({
    loggerInstance: logger as never,
    disableRequestLogging: env.NODE_ENV === 'test',
  }) as unknown as FastifyInstance;

  const healthMonitor = new SourceHealthMonitor(prisma);

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

  app.get('/ops/sources/health', async () => ({
    sources: await healthMonitor.sourceHealth(),
    generatedAt: new Date().toISOString(),
  }));

  app.get('/ops/matches/pending', async () => ({
    matches: await prisma.jobMatch.findMany({
      where: { status: 'new' },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      select: { id: true, score: true, status: true, createdAt: true },
    }),
  }));

  app.post<{ Body: { matchId: string; to: string } }>(
    '/ops/matches/:matchId/status',
    {
      schema: {
        params: {
          type: 'object',
          properties: { matchId: { type: 'string' } },
          required: ['matchId'],
        },
        body: {
          type: 'object',
          properties: { to: { type: 'string' } },
          required: ['to'],
        },
      },
    },
    async (request, reply) => {
      const { matchId } = request.params as { matchId: string };
      const { to } = request.body;

      const match = await prisma.jobMatch.findUnique({
        where: { id: matchId },
        include: { searchProfile: { select: { userId: true } }, job: true },
      });
      if (!match) return reply.code(404).send({ error: 'match not found' });

      if (!canTransition(match.status, to)) {
        return reply.code(422).send({
          error: `invalid transition ${match.status} → ${to}`,
          allowed: ['saved', 'not_relevant', 'applied', 'interested'].filter((t) =>
            canTransition(match.status, t),
          ),
        });
      }

      await prisma.$transaction([
        prisma.jobMatch.update({ where: { id: matchId }, data: { status: to } }),
        prisma.feedback.create({
          data: { userId: match.searchProfile.userId, jobId: match.jobId, action: to },
        }),
      ]);

      return { matchId, status: to };
    },
  );

  return { app, prisma };
}

export async function buildServer(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { app } = await buildApp(opts);
  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const env = loadEnv();
  const { app, prisma } = await buildApp();
  const port: number = env.PORT;
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}
