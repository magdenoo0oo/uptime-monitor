import mongoose from 'mongoose';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);

export async function connectDB(url) {
  await mongoose.connect(url);
  // Creates the time-series collection and waits for indexes (unique email,
  // one-open-incident-per-monitor, ...) before the app accepts traffic.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
