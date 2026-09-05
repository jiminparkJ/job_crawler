import { startServer } from './server.js';
import { loadEnv } from './config.js';
import { startWorker } from './pipeline/startWorker.js';
import { createLogger } from './logger.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

async function main() {
  const server = await startServer();
  logger.info(`Job Hunter API listening on port ${env.PORT}`);

  const worker = await startWorker({
    intervalMinutes: env.POLL_INTERVAL_MINUTES,
    jobvisionEnabled: env.JOBVISION_ENABLED,
    irantalentEnabled: env.IRANTALENT_ENABLED,
    keywords: ['node.js', 'backend', 'developer'],
    logger,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await worker.stop();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
