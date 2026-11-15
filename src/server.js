import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { initJobs, startWorker, stopJobs } from './jobs/index.js';

/**
 * API server. By default it also runs the job worker (RUN_WORKER=true), which
 * is simplest for one machine. In production you can run them separately:
 *   RUN_WORKER=false npm start   ← API only (still schedules jobs)
 *   npm run worker               ← checks + alerts only (scale this one)
 */
await connectDB(env.MONGO_URL);
await initJobs({ db: mongoose.connection.db });
if (env.RUN_WORKER) await startWorker();

const server = http.createServer(createApp());
server.listen(env.PORT, () => logger.info(`Uptime Monitor API on http://localhost:${env.PORT} (docs: /docs)`));

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 15_000).unref();
  await new Promise((resolve) => server.close(resolve));
  await stopJobs(); // lets in-flight checks finish
  await disconnectDB();
  clearTimeout(force);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
