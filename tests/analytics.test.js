import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getAgenda } from '../src/jobs/agenda.js';
import { reconcileSchedules } from '../src/jobs/scheduler.js';
import { Alert } from '../src/models/Alert.js';
import { Check } from '../src/models/Check.js';
import { Incident } from '../src/models/Incident.js';
import { insertMonitor, registerUser, startTestServer } from './helpers.js';

let ctx;
let me;

beforeAll(async () => {
  ctx = await startTestServer();
});
afterAll(() => ctx.stop());
beforeEach(async () => {
  await ctx.reset();
  me = await registerUser(ctx);
});

const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

/** 100 checks over the last ~10h: 95 up (100..195ms), 5 down. */
async function seedChecks(monitor) {
  const checks = Array.from({ length: 100 }, (_, i) => {
    const up = i >= 5;
    return {
      monitor: monitor._id,
      timestamp: ago(i * 6 * 60 * 1000 + 1000),
      up,
      statusCode: up ? 200 : 503,
      responseTimeMs: up ? 100 + i : null,
      error: up ? null : 'Unexpected status 503',
    };
  });
  // One check from 3 days ago must not count in the 24h stats.
  checks.push({ monitor: monitor._id, timestamp: ago(72 * HOUR), up: false, responseTimeMs: null });
  await Check.insertMany(checks);
}

describe('stats', () => {
  it('computes uptime, response-time percentiles and clipped downtime', async () => {
    const monitor = await insertMonitor(me);
    await seedChecks(monitor);
    // Incident from 30h ago to 4h ago. Only the part inside the window counts: 24h ago → 4h ago = 20h.
    await Incident.create({
      monitor: monitor._id,
      owner: monitor.owner,
      startedAt: ago(30 * HOUR),
      resolvedAt: ago(4 * HOUR),
      isOpen: false,
      resolution: 'recovered',
      cause: 'Timeout',
    });

    const { body } = await ctx.api().get(`/api/v1/monitors/${monitor.id}/stats?period=24h`).set(me.auth).expect(200);
    expect(body).toMatchObject({ period: '24h', checks: 100, upChecks: 95, uptimePercent: 95, incidents: 1 });
    expect(body.responseTimeMs).toMatchObject({ min: 105, max: 199, avg: 152 });
    expect(body.responseTimeMs.p95).toBeGreaterThanOrEqual(190);
    expect(body.downtimeMs).toBeGreaterThan(20 * HOUR - 5000);
    expect(body.downtimeMs).toBeLessThan(20 * HOUR + 5000);

    const week = await ctx.api().get(`/api/v1/monitors/${monitor.id}/stats?period=7d`).set(me.auth).expect(200);
    expect(week.body.checks).toBe(101);

    await ctx.api().get(`/api/v1/monitors/${monitor.id}/stats?period=1y`).set(me.auth).expect(400);
  });

  it('returns nulls, not NaN, for a monitor with no checks yet', async () => {
    const monitor = await insertMonitor(me);
    const { body } = await ctx.api().get(`/api/v1/monitors/${monitor.id}/stats`).set(me.auth).expect(200);
    expect(body).toMatchObject({ checks: 0, uptimePercent: null, responseTimeMs: { avg: null, p95: null } });
  });

  it('groups response times into time buckets for charts', async () => {
    const monitor = await insertMonitor(me);
    await seedChecks(monitor);

    const { body } = await ctx.api().get(`/api/v1/monitors/${monitor.id}/response-times?period=24h`).set(me.auth).expect(200);
    expect(body.bucket).toBe('1h');
    expect(body.data.length).toBeGreaterThanOrEqual(10);
    expect(body.data.length).toBeLessThanOrEqual(12);
    expect(body.data.reduce((s, p) => s + p.checks, 0)).toBe(100);
    for (let i = 1; i < body.data.length; i += 1) {
      expect(new Date(body.data[i].time) > new Date(body.data[i - 1].time)).toBe(true);
    }

    await ctx.api().get(`/api/v1/monitors/${monitor.id}/response-times?period=90d&bucket=5m`).set(me.auth).expect(400);
  });

  it('home dashboard shows 24h uptime per monitor in one call', async () => {
    const a = await insertMonitor(me, { name: 'A' });
    await insertMonitor(me, { name: 'B' });
    await seedChecks(a);

    const { body } = await ctx.api().get('/api/v1/monitors').set(me.auth).expect(200);
    const byName = Object.fromEntries(body.data.map((m) => [m.name, m.uptime24h]));
    expect(byName).toEqual({ A: 95, B: null });
  });
});

describe('history', () => {
  it('paginates raw checks by cursor, newest first', async () => {
    const monitor = await insertMonitor(me);
    await seedChecks(monitor);

    const seen = [];
    let cursor = '';
    do {
      const { body } = await ctx
        .api()
        .get(`/api/v1/monitors/${monitor.id}/checks?limit=40${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        .set(me.auth)
        .expect(200);
      seen.push(...body.data.map((c) => c.at));
      cursor = body.pageInfo.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(101);
    expect(new Set(seen).size).toBe(101);
    expect([...seen].sort().reverse()).toEqual(seen);
  });

  it('lists incidents with the alerts sent for each', async () => {
    const monitor = await insertMonitor(me);
    const incident = await Incident.create({
      monitor: monitor._id,
      owner: monitor.owner,
      startedAt: ago(HOUR),
      cause: 'Timeout after 2000ms',
    });
    await Alert.create({ monitor: monitor._id, incident: incident._id, owner: monitor.owner, type: 'down', to: 'a@b.c', status: 'sent', attempts: 1 });

    const { body } = await ctx.api().get(`/api/v1/monitors/${monitor.id}/incidents`).set(me.auth).expect(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ ongoing: true, cause: 'Timeout after 2000ms', resolvedAt: null });
    expect(body.data[0].durationMs).toBeGreaterThanOrEqual(HOUR);
    expect(body.data[0].alerts).toEqual([expect.objectContaining({ type: 'down', status: 'sent', to: 'a@b.c' })]);
  });
});

describe('public status page', () => {
  it('shows only public monitors, never their URLs, with an overall status', async () => {
    await ctx.api().patch('/api/v1/users/me').set(me.auth).send({ statusPageSlug: 'acme' }).expect(200);
    const api = await insertMonitor(me, { name: 'API', public: true, status: 'up', url: 'https://secret.internal/api' });
    await insertMonitor(me, { name: 'Website', public: true, status: 'down' });
    await insertMonitor(me, { name: 'Admin panel', public: false, status: 'up' });
    await seedChecks(api);

    const { body } = await ctx.api().get('/api/v1/status/ACME').expect(200);
    expect(body.page.slug).toBe('acme');
    expect(body.overall).toBe('partial_outage');
    expect(body.monitors.map((m) => m.name)).toEqual(['API', 'Website']);
    expect(JSON.stringify(body)).not.toContain('secret.internal');
    expect(body.monitors[0].uptime30d).toBeCloseTo(94.059, 2); // 95 / 101
    expect(body.monitors[0].days.length).toBeGreaterThanOrEqual(2);

    await ctx.api().get('/api/v1/status/nobody').expect(404);
  });
});

describe('scheduler', () => {
  it('reconcile adds missing jobs and removes orphans, leaving existing ones untouched', async () => {
    const kept = await insertMonitor(me);
    const missing = await insertMonitor(me);
    await insertMonitor(me, { paused: true });

    await getAgenda()
      .create('check-monitor', { monitorId: String(kept._id) })
      .unique({ 'data.monitorId': String(kept._id) })
      .repeatEvery('5 minutes')
      .schedule(new Date(Date.now() + HOUR))
      .save();
    await getAgenda().create('check-monitor', { monitorId: '64b000000000000000000000' }).repeatEvery('5 minutes').save();
    const keptBefore = await ctx.jobs().findOne({ 'data.monitorId': String(kept._id) });

    await reconcileSchedules();

    const jobs = await ctx.jobs().find({ name: 'check-monitor' }).toArray();
    expect(jobs.map((j) => j.data.monitorId).sort()).toEqual([String(kept._id), String(missing._id)].sort());
    const keptAfter = jobs.find((j) => j.data.monitorId === String(kept._id));
    expect(keptAfter.nextRunAt).toEqual(keptBefore.nextRunAt); // restart didn't reset its timer
  });
});
