import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { Check } from '../../models/Check.js';
import { Monitor } from '../../models/Monitor.js';
import { User } from '../../models/User.js';
import { notFound } from '../../utils/errors.js';
import { periodStart } from '../../utils/validation.js';

const percent = (up, total) => (total ? Math.round((up / total) * 100_000) / 1000 : null);

export const statusRoutes = Router();

/**
 * Public status page (no auth), like status.example.com. Only monitors the
 * owner marked `public` are listed, and URLs are never exposed.
 */
statusRoutes.get('/:slug', validate({ params: z.object({ slug: z.string().toLowerCase().max(40) }) }), async (req, res) => {
  const owner = await User.findOne({ statusPageSlug: req.valid.params.slug }).select('name statusPageSlug').lean();
  if (!owner) throw notFound('Status page not found');

  const monitors = await Monitor.find({ owner: owner._id, public: true }).sort({ name: 1 }).lean();

  // Daily uptime for the last 30 days, every monitor, one aggregation.
  const rows = await Check.aggregate([
    { $match: { monitor: { $in: monitors.map((m) => m._id) }, timestamp: { $gte: periodStart('30d') } } },
    {
      $group: {
        _id: { monitor: '$monitor', day: { $dateTrunc: { date: '$timestamp', unit: 'day' } } },
        total: { $sum: 1 },
        up: { $sum: { $cond: ['$up', 1, 0] } },
      },
    },
    { $sort: { '_id.day': 1 } },
  ]);
  const byMonitor = Map.groupBy(rows, (r) => String(r._id.monitor));

  const items = monitors.map((m) => {
    const days = byMonitor.get(String(m._id)) ?? [];
    const total = days.reduce((s, d) => s + d.total, 0);
    const up = days.reduce((s, d) => s + d.up, 0);
    return {
      name: m.name,
      status: m.paused ? 'paused' : m.status,
      lastCheckedAt: m.lastCheckedAt ?? null,
      uptime30d: percent(up, total),
      days: days.map((d) => ({ date: d._id.day.toISOString().slice(0, 10), uptimePercent: percent(d.up, d.total) })),
    };
  });

  const active = items.filter((i) => i.status === 'up' || i.status === 'down');
  const down = active.filter((i) => i.status === 'down').length;
  const overall = down === 0 ? 'operational' : down === active.length ? 'major_outage' : 'partial_outage';

  res.json({ page: { title: owner.name, slug: owner.statusPageSlug }, overall, monitors: items, generatedAt: new Date() });
});
