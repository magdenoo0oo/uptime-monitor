import { Check } from '../../models/Check.js';
import { Incident } from '../../models/Incident.js';
import { badRequest } from '../../utils/errors.js';
import { PERIODS, periodStart } from '../../utils/validation.js';
import { BUCKETS } from './monitors.schemas.js';

const percent = (up, total) => (total ? Math.round((up / total) * 100_000) / 1000 : null);
const round = (n) => (n == null ? null : Math.round(n));

// Response time only makes sense for successful checks; failed ones (timeouts)
// become null, which $avg / $min / $percentile simply ignore.
const okResponseTime = { $cond: ['$up', '$responseTimeMs', null] };

/** Uptime % per monitor, in ONE query for the whole dashboard. */
export async function uptimeByMonitor(monitorIds, since) {
  if (monitorIds.length === 0) return new Map();
  const rows = await Check.aggregate([
    { $match: { monitor: { $in: monitorIds }, timestamp: { $gte: since } } },
    { $group: { _id: '$monitor', total: { $sum: 1 }, up: { $sum: { $cond: ['$up', 1, 0] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), percent(r.up, r.total)]));
}

export async function monitorStats(monitor, period) {
  const to = new Date();
  const from = periodStart(period, to.getTime());

  const [agg] = await Check.aggregate([
    { $match: { monitor: monitor._id, timestamp: { $gte: from } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        up: { $sum: { $cond: ['$up', 1, 0] } },
        avg: { $avg: okResponseTime },
        min: { $min: okResponseTime },
        max: { $max: okResponseTime },
        // $percentile needs MongoDB 7.0+
        pct: { $percentile: { input: okResponseTime, p: [0.5, 0.95, 0.99], method: 'approximate' } },
      },
    },
  ]);

  // Downtime from incidents overlapping the period (clipped to it).
  const incidents = await Incident.find({
    monitor: monitor._id,
    startedAt: { $lt: to },
    $or: [{ resolvedAt: null }, { resolvedAt: { $gt: from } }],
  }).lean();
  const downtimeMs = incidents.reduce(
    (sum, i) => sum + (Math.min(+(i.resolvedAt ?? to), +to) - Math.max(+i.startedAt, +from)),
    0,
  );

  return {
    period,
    from,
    to,
    checks: agg?.total ?? 0,
    upChecks: agg?.up ?? 0,
    uptimePercent: percent(agg?.up ?? 0, agg?.total ?? 0),
    responseTimeMs: {
      avg: round(agg?.avg),
      min: agg?.min ?? null,
      max: agg?.max ?? null,
      p50: round(agg?.pct?.[0]),
      p95: round(agg?.pct?.[1]),
      p99: round(agg?.pct?.[2]),
    },
    incidents: incidents.length,
    downtimeMs,
  };
}

const DEFAULT_BUCKET = { '24h': '1h', '7d': '6h', '30d': '1d', '90d': '1d' };
const BUCKET_MINUTES = { minute: 1, hour: 60, day: 1440 };
const MAX_POINTS = 1000;

/** Time series for charts: one point per bucket ($dateTrunc groups by time window). */
export async function responseTimeSeries(monitor, period, bucket = DEFAULT_BUCKET[period]) {
  const [unit, binSize] = BUCKETS[bucket];
  const points = (PERIODS[period] * 60) / (BUCKET_MINUTES[unit] * binSize);
  if (points > MAX_POINTS) throw badRequest(`Bucket ${bucket} is too small for ${period} (max ${MAX_POINTS} points)`);

  const rows = await Check.aggregate([
    { $match: { monitor: monitor._id, timestamp: { $gte: periodStart(period) } } },
    {
      $group: {
        _id: { $dateTrunc: { date: '$timestamp', unit, binSize } },
        total: { $sum: 1 },
        up: { $sum: { $cond: ['$up', 1, 0] } },
        avg: { $avg: okResponseTime },
        pct: { $percentile: { input: okResponseTime, p: [0.95], method: 'approximate' } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    period,
    bucket,
    data: rows.map((r) => ({
      time: r._id,
      checks: r.total,
      uptimePercent: percent(r.up, r.total),
      avgMs: round(r.avg),
      p95Ms: round(r.pct?.[0]),
    })),
  };
}
