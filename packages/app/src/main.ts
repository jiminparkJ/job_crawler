import { startServer } from './server.js';
import { loadEnv } from './config.js';

const env = loadEnv();

startServer()
  .then((app) => {
    const goodbye = async (signal: string) => {
      app.log.info({ signal }, 'shutting down');
      await app.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void goodbye('SIGINT'));
    process.on('SIGTERM', () => void goodbye('SIGTERM'));
    app.log.info(`Job Hunter API listening on port ${env.PORT}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console -- startup failure before logger exists
    console.error('Failed to start server', err);
    process.exit(1);
  });
