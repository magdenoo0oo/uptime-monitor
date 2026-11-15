import { z } from 'zod';

// Zod parses every input into plain strings/numbers before it reaches a query,
// so objects like { "$ne": null } can never sneak into a MongoDB filter.
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid id');

export const limitParam = (max, fallback) => z.coerce.number().int().min(1).max(max).default(fallback);

export const PERIODS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 };
export const periodParam = z.enum(Object.keys(PERIODS)).default('24h');
export const periodStart = (period, now = Date.now()) => new Date(now - PERIODS[period] * 60 * 60 * 1000);
