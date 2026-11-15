/**
 * Live demo of the full outage lifecycle, against your running server.
 *   1) npm run dev     (with ALLOW_PRIVATE_TARGETS=true in .env, the default for local dev)
 *   2) npm run demo
 *
 * It starts a tiny fake "shop" website, monitors it, breaks it, fixes it,
 * and prints what the API reports at each step. Watch the server terminal:
 * the DOWN / RECOVERED emails are logged there when SMTP_URL is not set.
 */
import http from 'node:http';

const BASE = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4100}`;
const c = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const step = (text) => console.log(`\n${c.bold}▶ ${text}${c.reset}`);
const show = (label, value) => console.log(`  ${label.padEnd(14)} ${c.dim}${typeof value === 'string' ? value : JSON.stringify(value)}${c.reset}`);
const statusColor = (s) => (s === 'up' ? c.green : s === 'down' ? c.red : c.yellow) + s + c.reset;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The fake website ─────────────────────────────────────────────────────────
let siteStatus = 200;
const site = http.createServer((_req, res) => {
  res.writeHead(siteStatus, { 'content-type': 'text/html' });
  res.end(siteStatus === 200 ? '<h1>Demo Shop</h1>' : '<h1>Service Unavailable</h1>');
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const siteUrl = `http://127.0.0.1:${site.address().port}/`;

// ── API helper ───────────────────────────────────────────────────────────────
let token;
async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

try {
  await fetch(`${BASE}/health`);
} catch {
  console.error(`Can't reach ${BASE}. Start the server first: npm run dev`);
  process.exit(1);
}

// ── Demo ─────────────────────────────────────────────────────────────────────
const creds = { email: 'demo@uptime.local', password: 'demo-password' };
let auth = await api('POST', '/auth/login', creds);
if (auth.status !== 200) auth = await api('POST', '/auth/register', { name: 'Demo Co', ...creds });
token = auth.data.accessToken;
await api('PATCH', '/users/me', { statusPageSlug: 'demo-co', alertsEnabled: true });

step(`Create a monitor for the fake shop (${siteUrl})`);
const created = await api('POST', '/monitors', { name: 'Demo Shop', url: siteUrl, intervalMinutes: 1, keyword: 'Demo Shop', public: true });
if (created.status !== 201) {
  console.error(created.data);
  if (JSON.stringify(created.data).includes('Blocked')) console.error('→ Set ALLOW_PRIVATE_TARGETS=true in .env and restart the server.');
  process.exit(1);
}
const id = created.data.monitor.id;
show('status', statusColor(created.data.monitor.status));

step('The background worker (Agenda) runs the first check right away…');
let monitor;
for (let i = 0; i < 30; i += 1) {
  monitor = (await api('GET', `/monitors/${id}`)).data.monitor;
  if (monitor.status !== 'pending') break;
  await sleep(500);
}
show('status', statusColor(monitor.status));
show('last check', monitor.lastCheck);

step('Break the site (503) and run a real check now');
siteStatus = 503;
let check = (await api('POST', `/monitors/${id}/check`)).data;
show('status', statusColor(check.monitor.status));
show('transition', check.transition);
show('attempts', `${check.result.attempts} (1 try + backoff retries before declaring it down)`);
show('error', check.result.error);

step('Check again while still down: no new incident, no new email');
check = (await api('POST', `/monitors/${id}/check`)).data;
show('transition', check.transition);
show('attempts', `${check.result.attempts} (already down, no need to confirm)`);

step('Fix the site and check again');
siteStatus = 200;
check = (await api('POST', `/monitors/${id}/check`)).data;
show('status', statusColor(check.monitor.status));
show('transition', check.transition);

step('Wait for the alert job to deliver the emails…');
show('note', 'the worker polls for due jobs every JOBS_PROCESS_EVERY_MS (5s by default)');
let incidents;
for (let i = 0; i < 40; i += 1) {
  incidents = (await api('GET', `/monitors/${id}/incidents`)).data;
  const alerts = incidents.data.flatMap((inc) => inc.alerts);
  if (alerts.length >= 2 && alerts.every((a) => a.status !== 'queued')) break;
  await sleep(500);
}

step('Incident history with the alerts that were sent');
for (const inc of incidents.data) {
  show('incident', `${inc.cause} — lasted ${Math.round(inc.durationMs / 1000)}s, ${inc.ongoing ? 'ongoing' : `resolved (${inc.resolution})`}`);
  for (const a of inc.alerts) show('  alert', `${a.type} → ${a.to}: ${a.status} after ${a.attempts} attempt(s)`);
}

step('Stats for the last 24h (aggregated from the time-series collection)');
const { data: stats } = await api('GET', `/monitors/${id}/stats?period=24h`);
show('uptime', `${stats.uptimePercent}% over ${stats.checks} checks`);
show('response', stats.responseTimeMs);
show('downtime', `${Math.round(stats.downtimeMs / 1000)}s`);

step('Public status page (no auth): GET /api/v1/status/demo-co');
token = undefined;
const { data: page } = await api('GET', '/status/demo-co');
show('overall', page.overall);
show('monitors', page.monitors.map((m) => `${m.name}: ${m.status}, ${m.uptime30d}% (30d)`));

token = auth.data.accessToken;
await api('DELETE', `/monitors/${id}`);
site.close();
console.log(`\n${c.dim}Demo monitor deleted. Swagger docs: ${BASE}/docs${c.reset}\nDone.`);
process.exit(0);
