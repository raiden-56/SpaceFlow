import fs from 'node:fs';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { closeAll } from './realtime/sse.js';
import { captureException, monitoringEnabled } from './lib/monitoring.js';

fs.mkdirSync(env.uploadDirAbs, { recursive: true });

const app = createApp();
const server = app.listen(env.API_PORT, () => {
  logger.info(
    { port: env.API_PORT, env: env.NODE_ENV, docs: `${env.API_BASE_URL}/api/v1/docs`, monitoring: monitoringEnabled },
    'SpaceFlow API listening',
  );
  startScheduler();
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  stopScheduler();
  closeAll();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandled rejection');
  captureException(err);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  captureException(err);
  void shutdown('uncaughtException');
});
