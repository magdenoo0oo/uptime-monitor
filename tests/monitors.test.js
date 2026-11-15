import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Check } from '../src/models/Check.js';
import { Monitor } from '../src/models/Monitor.js';
import { insertMonitor, registerUser, startTestServer, waitFor } from './helpers.js';

let ctx;
let me;
let other;

beforeAll(async () => {
  ctx = await startTestServer();
});
afterAll(() => ctx.stop());
beforeEach(async () => {
  await ctx.reset();
  [me, other] = await Promise.all([registerUser(ctx), registerUser(ctx)]);
  ctx.site.respond('/', { status: 200, body: 'hello' });
});

const create = (body, user = me) => ctx.api().post('/api/v1/monitors').set(user.auth).send(body);
const jobFor = (id) => ctx.jobs().findOne({ name: 'check-monitor', 'data.monitorId': String(id) });

describe('auth & profile', () => {
  it('registers, logs in, rotates refresh tokens and protects routes', async () => {
    await ctx.api().get('/api/v1/monitors').expect(401);
    const login = await ctx
      .api()
      .post('/api/v1/auth/login')
      .send({ email: me.user.email.toUpperCase(), password: 'password123' })
      .expect(200);
    await ctx.api().post('/api/v1/auth/login').send({ email: me.user.email, password: 'nope-nope' }).expect(401);
    await ctx.api().post('/api/v1/auth/register').send({ name: 'X', email: me.user.email, password: 'password123' }).expect(409);

    const refreshed = await ctx.api().post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    await ctx.api().post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401); // replay
    await ctx.api().post('/api/v1/auth/refresh').send({ refreshToken: refreshed.body.refreshToken }).expect(401); // family revoked
  });

  it('updates alert settings and claims a unique status page slug', async () => {
    const res = await ctx
      .api()
      .patch('/api/v1/users/me')
      .set(me.auth)
      .send({ alertsEnabled: false, statusPageSlug: 'My-Shop' })
      .expect(200);
    expect(res.body.user).toMatchObject({ alertsEnabled: false, statusPageSlug: 'my-shop' });

    await ctx.api().patch('/api/v1/users/me').set(other.auth).send({ statusPageSlug: 'my-shop' }).expect(409);
    await ctx.api().patch('/api/v1/users/me').set(other.auth).send({ statusPageSlug: 'a' }).expect(400);
    const cleared = await ctx.api().patch('/api/v1/users/me').set(me.auth).send({ statusPageSlug: null }).expect(200);
    expect(cleared.body.user.statusPageSlug).toBeNull();
  });
});

describe('monitors CRUD', () => {
  it('creates a monitor with sensible defaults and schedules its job', async () => {
    const res = await create({ name: 'Home', url: ctx.site.url('/') }).expect(201);
    expect(res.body.monitor).toMatchObject({
      name: 'Home',
      method: 'GET',
      intervalMinutes: 5,
      timeoutMs: 10_000,
      acceptedStatus: { min: 200, max: 399 },
      keyword: null,
      public: false,
      paused: false,
      status: 'pending',
      lastCheck: null,
    });

    const job = await jobFor(res.body.monitor.id);
    expect(job).toMatchObject({ repeatInterval: '5 minutes' });
  });

  it('runs the first check right away in the background', async () => {
    const { body } = await create({ name: 'Home', url: ctx.site.url('/') }).expect(201);
    const monitor = await waitFor(async () => {
      const r = await ctx.api().get(`/api/v1/monitors/${body.monitor.id}`).set(me.auth);
      return r.body.monitor.status === 'up' && r.body.monitor;
    });
    expect(monitor.lastCheck).toMatchObject({ statusCode: 200, error: null });
    expect(await Check.countDocuments({ monitor: body.monitor.id })).toBeGreaterThanOrEqual(1);
  });

  it('validates input', async () => {
    const bad = await create({ name: '', url: 'ftp://example.com', intervalMinutes: 0, timeoutMs: 999_999 }).expect(400);
    expect(bad.body.error.details.map((d) => d.path)).toEqual(
      expect.arrayContaining(['body.name', 'body.url', 'body.intervalMinutes', 'body.timeoutMs']),
    );
    await create({ name: 'x', url: ctx.site.url('/'), method: 'HEAD', keyword: 'hi' }).expect(400);
    await create({ name: 'x', url: ctx.site.url('/'), acceptedStatus: { min: 400, max: 200 } }).expect(400);
  });

  it("hides other users' monitors behind a 404", async () => {
    const { body } = await create({ name: 'Mine', url: ctx.site.url('/') }).expect(201);
    const id = body.monitor.id;
    await ctx.api().get(`/api/v1/monitors/${id}`).set(other.auth).expect(404);
    await ctx.api().patch(`/api/v1/monitors/${id}`).set(other.auth).send({ name: 'Hacked' }).expect(404);
    await ctx.api().delete(`/api/v1/monitors/${id}`).set(other.auth).expect(404);
    await ctx.api().get(`/api/v1/monitors/${id}/stats`).set(other.auth).expect(404);
    const list = await ctx.api().get('/api/v1/monitors').set(other.auth).expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('PATCH only changes the fields sent, and reschedules on interval change', async () => {
    const { body } = await create({ name: 'A', url: ctx.site.url('/'), timeoutMs: 3000, public: true }).expect(201);
    const id = body.monitor.id;

    const res = await ctx.api().patch(`/api/v1/monitors/${id}`).set(me.auth).send({ intervalMinutes: 15 }).expect(200);
    expect(res.body.monitor).toMatchObject({ name: 'A', timeoutMs: 3000, public: true, intervalMinutes: 15 });
    expect((await jobFor(id)).repeatInterval).toBe('15 minutes');
    expect(await ctx.jobs().countDocuments({ name: 'check-monitor' })).toBe(1);

    await ctx.api().patch(`/api/v1/monitors/${id}`).set(me.auth).send({}).expect(400);
  });

  it('pausing removes the job, resuming brings it back', async () => {
    const { body } = await create({ name: 'A', url: ctx.site.url('/') }).expect(201);
    const id = body.monitor.id;

    const paused = await ctx.api().patch(`/api/v1/monitors/${id}`).set(me.auth).send({ paused: true }).expect(200);
    expect(paused.body.monitor.status).toBe('paused');
    expect(await jobFor(id)).toBeNull();

    const resumed = await ctx.api().patch(`/api/v1/monitors/${id}`).set(me.auth).send({ paused: false }).expect(200);
    expect(resumed.body.monitor.status).toBe('pending');
    expect(await jobFor(id)).not.toBeNull();
  });

  it('deleting removes the job and all history', async () => {
    const { body } = await create({ name: 'A', url: ctx.site.url('/') }).expect(201);
    const id = body.monitor.id;
    await waitFor(() => Check.exists({ monitor: id }));

    await ctx.api().delete(`/api/v1/monitors/${id}`).set(me.auth).expect(204);
    expect(await jobFor(id)).toBeNull();
    expect(await Check.countDocuments({ monitor: id })).toBe(0);
    await ctx.api().get(`/api/v1/monitors/${id}`).set(me.auth).expect(404);
  });

  it('enforces the per-user monitor limit', async () => {
    await Monitor.insertMany(
      Array.from({ length: 50 }, (_, i) => ({ owner: me.user.id, name: `m${i}`, url: 'https://example.com', intervalMinutes: 5, timeoutMs: 5000 })),
    );
    const res = await create({ name: 'one too many', url: ctx.site.url('/') }).expect(400);
    expect(res.body.error.message).toMatch(/at most 50/);
  });

  it('POST /check runs a real check: saved, status updated, incident opened', async () => {
    ctx.site.respond('/api', { status: 500 });
    const monitor = await insertMonitor(me, { url: ctx.site.url('/api') });

    const res = await ctx.api().post(`/api/v1/monitors/${monitor.id}/check`).set(me.auth).expect(200);
    expect(res.body).toMatchObject({ transition: 'went-down', result: { up: false, attempts: 3 }, monitor: { status: 'down' } });
    expect(await Check.countDocuments({ monitor: monitor._id })).toBe(1);

    await ctx.api().patch(`/api/v1/monitors/${monitor.id}`).set(me.auth).send({ paused: true }).expect(200);
    await ctx.api().post(`/api/v1/monitors/${monitor.id}/check`).set(me.auth).expect(400);
  });

  it('POST /test probes immediately without saving anything', async () => {
    ctx.site.respond('/broken', { status: 502 });
    const monitor = await insertMonitor(me, { url: ctx.site.url('/broken') });

    const res = await ctx.api().post(`/api/v1/monitors/${monitor.id}/test`).set(me.auth).expect(200);
    expect(res.body.result).toMatchObject({ up: false, statusCode: 502, error: 'Unexpected status 502' });
    expect(await Check.countDocuments({ monitor: monitor._id })).toBe(0);
    expect((await Monitor.findById(monitor._id)).status).toBe('pending');
  });
});
