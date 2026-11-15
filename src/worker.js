import mongoose from 'mongoose';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { initJobs, startWorker, stopJobs } from './jobs/index.js';

/**
 * Standalone worker: runs checks and sends alerts, no HTTP server. Start as
 * many as you need — Agenda locks each job so no check runs twice.
 */
await connectDB(env.MONGO_URL);
await initJobs({ db: mongoose.connection.db });
await startWorker();

async function shutdown(signal) {
  logger.info(`${signal} received, draining jobs`);
  const force = setTimeout(() => process.exit(1), 15_000).unref();
  await stopJobs();
  await disconnectDB();
  clearTimeout(force);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
