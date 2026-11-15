/**
 * One data round: probe every site in data/targets.json with the project's own
 * probe (same retries + SSRF guard as the API) and update the files in data/.
 * Run by .github/workflows/collect.yml 20–30 times a day; also works locally:
 *
 *   node scripts/collect.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';

// The collector shares src/ with the API but never touches MongoDB or tokens.
// These placeholders only satisfy the shared env validation in src/config/env.js.
process.env.MONGO_URL ??= 'mongodb://not-used-by-the-collector';
process.env.JWT_ACCESS_SECRET ??= 'not-used-by-the-collector-not-used-by-the-collector';
process.env.NODE_ENV ??= 'production';
process.env.LOG_LEVEL ??= 'silent';
process.env.ALLOW_PRIVATE_TARGETS = 'false';

const { probeWithRetries } = await import('../src/checks/probe.js');
const { nextDaily, nextIncidents, nextLatest, statusMarkdown, summarize } = await import('../src/collector/state.js');

const DATA = path.resolve(import.meta.dirname, '..', 'data');
const file = (...parts) => path.join(DATA, ...parts);

async function readJson(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}
const writeJson = (p, value) => fs.writeFile(p, `${JSON.stringify(value, null, 2)}\n`);

const targets = await readJson(file('targets.json'));
const previous = await readJson(file('latest.json'), null);
const prevStatus = new Map((previous?.sites ?? []).map((s) => [s.id, s.status]));

const results = await Promise.all(
  targets.map((t) =>
    probeWithRetries(
      {
        url: t.url,
        method: 'GET',
        timeoutMs: 15_000,
        acceptedStatus: { min: 100, max: 499 }, // a 403 from bot protection still means the server is up
        status: prevStatus.get(t.id) ?? 'pending', // already down → single probe, no retries
      },
      { retries: 2, baseMs: 3000 },
    ),
  ),
);

const checkedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const date = checkedAt.slice(0, 10);

const latest = nextLatest(previous, targets, results, checkedAt);
const daily = nextDaily(await readJson(file('daily', `${date}.json`), null), date, latest);
const incidents = nextIncidents(await readJson(file('incidents.json'), []), previous, latest);

await fs.mkdir(file('daily'), { recursive: true });
await writeJson(file('latest.json'), latest);
await writeJson(file('daily', `${date}.json`), daily);
await writeJson(file('incidents.json'), incidents);

const dayFiles = (await fs.readdir(file('daily'))).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 30);
const dailies = await Promise.all(dayFiles.map((f) => readJson(file('daily', f))));
const summary = summarize(targets, dailies, latest);
await writeJson(file('summary.json'), summary);
await fs.writeFile(file('STATUS.md'), statusMarkdown(summary, incidents));

const down = latest.sites.filter((s) => s.status === 'down');
console.log(`${checkedAt}: ${latest.sites.length - down.length}/${latest.sites.length} up${down.length ? ` — down: ${down.map((s) => `${s.id} (${s.error})`).join(', ')}` : ''}`);
