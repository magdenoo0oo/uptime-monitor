import { request } from 'undici';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backoffDelay } from '../src/checks/backoff.js';
import { probe, probeWithRetries } from '../src/checks/probe.js';
import { assertPublicUrl, createDispatcher, isPrivateAddress } from '../src/checks/safeNetwork.js';
import { startFakeSite } from './helpers.js';

let site;
beforeAll(async () => {
  site = await startFakeSite();
});
afterAll(() => site.close());
beforeEach(() => site.reset());

const monitor = (path, extra = {}) => ({ url: site.url(path), method: 'GET', timeoutMs: 1000, status: 'up', ...extra });

describe('probe', () => {
  it('reports up with status code and response time', async () => {
    site.respond('/ok', { status: 200 });
    const r = await probe(monitor('/ok'));
    expect(r).toMatchObject({ up: true, statusCode: 200, error: null });
    expect(r.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('treats unexpected status codes as down, honouring acceptedStatus', async () => {
    site.respond('/err', { status: 503 });
    expect(await probe(monitor('/err'))).toMatchObject({ up: false, statusCode: 503, error: 'Unexpected status 503' });

    site.respond('/gone', { status: 404 });
    expect((await probe(monitor('/gone', { acceptedStatus: { min: 200, max: 499 } }))).up).toBe(true);
  });

  it('times out slow sites', async () => {
    site.respond('/slow', { status: 200, delayMs: 1500 });
    const r = await probe(monitor('/slow', { timeoutMs: 1000 }));
    expect(r).toMatchObject({ up: false, statusCode: null, error: 'Timeout after 1000ms' });
  });

  it('checks for a keyword in the body (catches "200 OK" error pages)', async () => {
    site.respond('/page', { status: 200, body: '<h1>Welcome to the shop — مرحبا</h1>' });
    expect((await probe(monitor('/page', { keyword: 'مرحبا' }))).up).toBe(true);
    expect(await probe(monitor('/page', { keyword: 'Checkout' }))).toMatchObject({
      up: false,
      statusCode: 200,
      error: 'Keyword "Checkout" not found',
    });
  });

  it('reports connection errors clearly', async () => {
    const r = await probe({ url: 'http://127.0.0.1:1/', timeoutMs: 1000 });
    expect(r).toMatchObject({ up: false, error: 'Connection refused' });
  });
});

describe('retries with exponential backoff', () => {
  it('recovers from a blip without reporting down', async () => {
    site.respond('/flaky', { status: 500 }, { status: 500 }, { status: 200 });
    const r = await probeWithRetries(monitor('/flaky'));
    expect(r).toMatchObject({ up: true, attempts: 3 });
    expect(site.hits('/flaky')).toBe(3);
  });

  it('gives up after CHECK_RETRIES and waits longer between each try', async () => {
    site.respond('/down', { status: 500 });
    const started = Date.now();
    const r = await probeWithRetries(monitor('/down'), { retries: 2, baseMs: 100 });
    expect(r).toMatchObject({ up: false, attempts: 3, statusCode: 500 });
    // waits ≈ 100ms + 200ms (±20%) → at least 240ms
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
  });

  it('does not retry when the monitor is already down (just waiting for recovery)', async () => {
    site.respond('/still-down', { status: 500 });
    const r = await probeWithRetries(monitor('/still-down', { status: 'down' }));
    expect(r.attempts).toBe(1);
    expect(site.hits('/still-down')).toBe(1);
  });

  it('backoffDelay doubles each attempt within ±20% jitter', () => {
    for (const [attempt, expected] of [
      [0, 1000],
      [1, 2000],
      [2, 4000],
      [3, 8000],
    ]) {
      const d = backoffDelay(attempt, 1000);
      expect(d).toBeGreaterThanOrEqual(expected * 0.8);
      expect(d).toBeLessThanOrEqual(expected * 1.2);
    }
    expect(backoffDelay(20, 1000)).toBeLessThanOrEqual(60_000 * 1.2); // capped
  });
});

describe('SSRF protection', () => {
  it('classifies private and public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '[::1]']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('rejects private IP literals, including encoded forms', () => {
    expect(() => assertPublicUrl('http://127.0.0.1:8080/')).toThrow(/Blocked/);
    expect(() => assertPublicUrl('http://0x7f000001/')).toThrow(/Blocked/); // URL parser normalises to 127.0.0.1
    expect(() => assertPublicUrl('http://[::1]/')).toThrow(/Blocked/);
    expect(() => assertPublicUrl('https://example.com/')).not.toThrow();
  });

  it('blocks hostnames that resolve to private addresses at connect time', async () => {
    const dispatcher = createDispatcher({ allowPrivate: false });
    const port = new URL(site.url('/')).port;
    await expect(request(`http://localhost:${port}/`, { dispatcher })).rejects.toMatchObject({ code: 'EBLOCKED' });
  });
});
