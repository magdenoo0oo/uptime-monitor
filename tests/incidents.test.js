import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { renderAlert } from '../src/alerts/templates.js';
import { applyResult, runCheck } from '../src/checks/runCheck.js';
import { Alert } from '../src/models/Alert.js';
import { Check } from '../src/models/Check.js';
import { Incident } from '../src/models/Incident.js';
import { Monitor } from '../src/models/Monitor.js';
import { User } from '../src/models/User.js';
import { insertMonitor, registerUser, startTestServer, waitFor } from './helpers.js';

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

const siteMonitor = (path, extra) => insertMonitor(me, { url: ctx.site.url(path), name: 'Shop', ...extra });
const reload = (monitor) => Monitor.findById(monitor._id).lean();

describe('status transitions', () => {
  it('pending → up: no incident, no alert', async () => {
    ctx.site.respond('/ok', { status: 200 });
    const monitor = await siteMonitor('/ok');

    const { transition, result } = await runCheck(monitor._id);
    expect(transition).toBe('unchanged');
    expect(result).toMatchObject({ up: true, attempts: 1 });
    expect(await reload(monitor)).toMatchObject({ status: 'up', lastStatusCode: 200 });
    expect(await Incident.countDocuments()).toBe(0);
  });

  it('a blip that recovers during the backoff retries never raises an alert', async () => {
    ctx.site.respond('/blip', { status: 500 }, { status: 200 });
    const monitor = await siteMonitor('/blip', { status: 'up' });

    const { result } = await runCheck(monitor._id);
    expect(result).toMatchObject({ up: true, attempts: 2 });
    expect(await Incident.countDocuments()).toBe(0);
    expect(await Alert.countDocuments()).toBe(0);
  });

  it('up → down → down → up: one incident, one DOWN and one RECOVERED email', async () => {
    ctx.site.respond('/shop', { status: 200 });
    const monitor = await siteMonitor('/shop');
    await runCheck(monitor._id);

    // It goes down: confirmed after 3 attempts (1 + CHECK_RETRIES)
    ctx.site.respond('/shop', { status: 503 });
    const down = await runCheck(monitor._id);
    expect(down).toMatchObject({ transition: 'went-down', result: { up: false, attempts: 3 } });

    const incident = await Incident.findOne({ monitor: monitor._id }).lean();
    expect(incident).toMatchObject({ isOpen: true, cause: 'Unexpected status 503', statusCode: 503 });
    await waitFor(() => ctx.mailbox.sent.length === 1);
    expect(ctx.mailbox.sent[0]).toMatchObject({ to: me.user.email, subject: '🔴 DOWN: Shop' });
    expect(ctx.mailbox.sent[0].text).toContain('Unexpected status 503');

    // Still down: no new incident, no new email, and no retries (already down)
    const still = await runCheck(monitor._id);
    expect(still).toMatchObject({ transition: 'unchanged', result: { attempts: 1 } });
    expect(await Incident.countDocuments()).toBe(1);

    // Back up
    ctx.site.respond('/shop', { status: 200 });
    expect((await runCheck(monitor._id)).transition).toBe('recovered');
    const resolved = await Incident.findById(incident._id).lean();
    expect(resolved).toMatchObject({ isOpen: false, resolution: 'recovered' });
    expect(resolved.resolvedAt.getTime()).toBeGreaterThan(resolved.startedAt.getTime());

    await waitFor(() => ctx.mailbox.sent.length === 2);
    expect(ctx.mailbox.sent[1].subject).toMatch(/^✅ RECOVERED: Shop \(down \d+s\)$/);
    expect(await Alert.countDocuments({ status: 'sent' })).toBe(2);
    expect(await Check.countDocuments({ monitor: monitor._id })).toBe(4);
  });

  it('respects alertsEnabled = false', async () => {
    await User.updateOne({ _id: me.user.id }, { alertsEnabled: false });
    ctx.site.respond('/x', { status: 500 });
    const monitor = await siteMonitor('/x');
    await runCheck(monitor._id);

    expect(await Incident.countDocuments({ isOpen: true })).toBe(1);
    expect(await Alert.countDocuments()).toBe(0);
  });

  it('discards a result if the monitor was edited while the check was running', async () => {
    const monitor = (await siteMonitor('/x')).toObject(); // what the running check loaded
    await ctx // the user edits it mid-check (same millisecond is fine)
      .api()
      .patch(`/api/v1/monitors/${monitor._id}`)
      .set(me.auth)
      .send({ url: 'https://example.com/new' })
      .expect(200);

    const transition = await applyResult(monitor, { up: false, statusCode: 500, error: 'boom' }, new Date());
    expect(transition).toBe('stale');
    expect((await reload(monitor)).status).toBe('pending');
    expect(await Incident.countDocuments()).toBe(0);
  });

  it('the database refuses a second open incident for the same monitor', async () => {
    const monitor = await siteMonitor('/x');
    const open = { monitor: monitor._id, owner: monitor.owner, startedAt: new Date(), cause: 'x' };
    await Incident.create(open);
    await expect(Incident.create(open)).rejects.toMatchObject({ code: 11000 });
    await Incident.create({ ...open, isOpen: false }); // closed ones are fine
  });

  it('skips paused and deleted monitors', async () => {
    const paused = await siteMonitor('/x', { paused: true });
    expect(await runCheck(paused._id)).toEqual({ skipped: 'paused' });
    await Monitor.deleteOne({ _id: paused._id });
    expect(await runCheck(paused._id)).toEqual({ skipped: 'deleted' });
  });
});

describe('alert delivery (Agenda retries with exponential backoff)', () => {
  it('retries when SMTP fails and eventually delivers', async () => {
    ctx.mailbox.failNext = 2;
    ctx.site.respond('/x', { status: 500 });
    await runCheck((await siteMonitor('/x'))._id);

    const alert = await waitFor(() => Alert.findOne({ status: 'sent' }).lean());
    expect(alert.attempts).toBe(3);
    expect(ctx.mailbox.sent).toHaveLength(1);
  });

  it('marks the alert failed after the retries are exhausted', async () => {
    ctx.mailbox.failAlways = true;
    ctx.site.respond('/x', { status: 500 });
    await runCheck((await siteMonitor('/x'))._id);

    const alert = await waitFor(() => Alert.findOne({ status: 'failed' }).lean());
    expect(alert).toMatchObject({ attempts: 4, lastError: 'SMTP connection refused' }); // 1 try + ALERT_MAX_RETRIES (3)
  });

  it('escapes user content in the HTML email', () => {
    const monitor = { name: '<img src=x onerror=alert(1)>', url: 'https://x.dev/?a=1&b=2' };
    const { html, subject } = renderAlert('down', monitor, { cause: '<script>', startedAt: new Date() });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('a=1&amp;b=2');
    expect(subject).toBe('🔴 DOWN: <img src=x onerror=alert(1)>'); // plain-text header, not HTML
  });
});

describe('editing a monitor', () => {
  it('pausing a down monitor closes its incident without a "recovered" email', async () => {
    ctx.site.respond('/x', { status: 500 });
    const monitor = await siteMonitor('/x');
    await runCheck(monitor._id);
    await waitFor(() => ctx.mailbox.sent.length === 1);

    await ctx.api().patch(`/api/v1/monitors/${monitor.id}`).set(me.auth).send({ paused: true }).expect(200);
    expect(await Incident.findOne({ monitor: monitor._id }).lean()).toMatchObject({ isOpen: false, resolution: 'paused' });

    await new Promise((r) => setTimeout(r, 300));
    expect(ctx.mailbox.sent).toHaveLength(1);
  });
});
