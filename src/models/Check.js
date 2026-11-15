import mongoose from 'mongoose';
import { env } from '../config/env.js';

/**
 * One document per check result, stored in a MongoDB **time-series collection**.
 *
 * Time-series collections group measurements of the same `metaField` (here: the
 * monitor) into compressed buckets ordered by time. Compared to a normal
 * collection this uses far less disk and makes "average response time per hour
 * for monitor X" style queries fast. Old data is deleted automatically after
 * CHECKS_RETENTION_DAYS (expireAfterSeconds).
 */
const checkSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true },
    monitor: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
    up: { type: Boolean, required: true },
    statusCode: { type: Number, default: null },
    responseTimeMs: { type: Number, default: null },
    error: { type: String, default: null },
    attempts: { type: Number, default: 1 },
  },
  {
    timeseries: { timeField: 'timestamp', metaField: 'monitor', granularity: 'minutes' },
    expireAfterSeconds: env.CHECKS_RETENTION_DAYS * 24 * 60 * 60,
    autoCreate: true,
    versionKey: false,
  },
);

checkSchema.index({ monitor: 1, timestamp: -1 });

export const Check = mongoose.model('Check', checkSchema);
