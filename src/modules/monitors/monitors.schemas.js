import { z } from 'zod';
import { limitParam, periodParam } from '../../utils/validation.js';

const fields = {
  name: z.string().trim().min(1).max(80),
  url: z.url({ protocol: /^https?$/, error: 'Must be an http(s) URL' }).max(2048),
  method: z.enum(['GET', 'HEAD']),
  intervalMinutes: z.number().int().min(1).max(1440),
  timeoutMs: z.number().int().min(1000).max(30_000),
  acceptedStatus: z
    .object({ min: z.number().int().min(100).max(599), max: z.number().int().min(100).max(599) })
    .refine((s) => s.min <= s.max, 'min must be <= max'),
  keyword: z.string().trim().min(1).max(200).nullable(),
  public: z.boolean(),
  paused: z.boolean(),
};

const keywordNeedsGet = (body) => !(body.keyword && body.method === 'HEAD');
const KEYWORD_MSG = { message: 'Keyword checks need the GET method (HEAD has no body)', path: ['keyword'] };

export const createMonitorSchema = z
  .object({
    name: fields.name,
    url: fields.url,
    method: fields.method.default('GET'),
    intervalMinutes: fields.intervalMinutes.default(5),
    timeoutMs: fields.timeoutMs.default(10_000),
    acceptedStatus: fields.acceptedStatus.default({ min: 200, max: 399 }),
    keyword: fields.keyword.default(null),
    public: fields.public.default(false),
  })
  .refine(keywordNeedsGet, KEYWORD_MSG);

// PATCH: every field optional and NO defaults, so omitted fields stay as they are.
export const updateMonitorSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update');

export const statsQuery = z.object({ period: periodParam });

export const BUCKETS = { '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '6h': ['hour', 6], '1d': ['day', 1] };
export const responseTimesQuery = z.object({
  period: periodParam,
  bucket: z.enum(Object.keys(BUCKETS)).optional(),
});

export const checksQuery = z.object({
  limit: limitParam(200, 50),
  cursor: z.iso.datetime({ offset: true }).optional(),
});

export const incidentsQuery = z.object({
  limit: limitParam(100, 20),
  cursor: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid cursor').optional(),
});
