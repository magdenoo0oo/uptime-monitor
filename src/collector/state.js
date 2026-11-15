/**
 * Pure functions that turn one round of probe results into the files under
 * data/. No I/O here, so it's all unit-tested (tests/collector.test.js).
 *
 *   data/latest.json        current status of every site + since when
 *   data/daily/<date>.json  per-day counters and response-time samples
 *   data/incidents.json     outages (opened on up→down, closed on down→up)
 *   data/summary.json       today / 7-day / 30-day uptime and latency per site
 *   data/STATUS.md          the same, as a table GitHub renders
 */

const MAX_INCIDENTS = 500;

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

const pct = (up, total) => (total ? Math.round((up / total) * 100_000) / 1000 : null);

/** New latest.json: carries `since` forward while a site keeps the same status. */
export function nextLatest(previous, targets, results, checkedAt) {
  const prevById = new Map((previous?.sites ?? []).map((s) => [s.id, s]));
  return {
    checkedAt,
    sites: targets.map((t, i) => {
      const r = results[i];
      const status = r.up ? 'up' : 'down';
      const prev = prevById.get(t.id);
      return {
        id: t.id,
        name: t.name,
        category: t.category,
        url: t.url,
        status,
        since: prev?.status === status ? prev.since : checkedAt,
        statusCode: r.statusCode,
        responseTimeMs: r.responseTimeMs,
        error: r.error,
        attempts: r.attempts,
      };
    }),
  };
}

/** Adds this round to the day's counters. */
export function nextDaily(previous, date, latest) {
  const day = previous ?? { date, sites: {} };
  for (const s of latest.sites) {
    const site = (day.sites[s.id] ??= { checks: 0, up: 0, responseTimesMs: [], errors: {} });
    site.checks += 1;
    if (s.status === 'up') {
      site.up += 1;
      site.responseTimesMs.push(s.responseTimeMs);
    } else {
      site.errors[s.error] = (site.errors[s.error] ?? 0) + 1;
    }
  }
  return day;
}

/** Opens an incident when a site goes down, closes it when it comes back. */
export function nextIncidents(previous, prevLatest, latest) {
  const incidents = [...(previous ?? [])];
  const wasDown = new Set((prevLatest?.sites ?? []).filter((s) => s.status === 'down').map((s) => s.id));

  for (const s of latest.sites) {
    const open = incidents.find((i) => i.site === s.id && i.resolvedAt === null);
    if (s.status === 'down' && !open) {
      incidents.unshift({ site: s.id, startedAt: latest.checkedAt, resolvedAt: null, cause: s.error });
    } else if (s.status === 'up' && open) {
      open.resolvedAt = latest.checkedAt;
    } else if (s.status === 'down' && open && !wasDown.has(s.id)) {
      open.cause = s.error; // keep the latest reason
    }
  }
  return incidents.slice(0, MAX_INCIDENTS);
}

/** Today / 7d / 30d stats per site from the daily files (newest first). */
export function summarize(targets, dailies, latest) {
  const windows = { today: 1, '7d': 7, '30d': 30 };
  return {
    generatedAt: latest.checkedAt,
    sites: targets.map((t) => {
      const current = latest.sites.find((s) => s.id === t.id);
      const stats = {};
      for (const [name, days] of Object.entries(windows)) {
        const rows = dailies.slice(0, days).map((d) => d.sites[t.id]).filter(Boolean);
        const checks = rows.reduce((s, r) => s + r.checks, 0);
        const up = rows.reduce((s, r) => s + r.up, 0);
        const times = rows.flatMap((r) => r.responseTimesMs);
        stats[name] = {
          checks,
          uptimePercent: pct(up, checks),
          avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
          p95Ms: percentile(times, 0.95),
        };
      }
      return { id: t.id, name: t.name, category: t.category, status: current.status, since: current.since, ...stats };
    }),
  };
}

const fmtPct = (v) => (v == null ? '—' : `${v.toFixed(v === 100 ? 0 : 2)}%`);
const fmtMs = (v) => (v == null ? '—' : `${v} ms`);

export function statusMarkdown(summary, incidents) {
  const rows = summary.sites
    .map(
      (s) =>
        `| ${s.status === 'up' ? '🟢' : '🔴'} | ${s.name} | ${s.category} | ${fmtPct(s.today.uptimePercent)} | ${fmtPct(s['7d'].uptimePercent)} | ${fmtPct(s['30d'].uptimePercent)} | ${fmtMs(s['7d'].p95Ms)} |`,
    )
    .join('\n');

  const recent = incidents.slice(0, 15);
  const incidentRows = recent.length
    ? recent
        .map((i) => {
          const name = summary.sites.find((s) => s.id === i.site)?.name ?? i.site;
          const end = i.resolvedAt ?? 'ongoing';
          return `| ${name} | ${i.startedAt} | ${end} | ${i.cause ?? ''} |`;
        })
        .join('\n')
    : '| — | — | — | No incidents recorded yet |';

  return `# Egyptian websites — live uptime

Checked 20–30 times a day by [\`collect.yml\`](../.github/workflows/collect.yml) using this project's own probe
(exponential-backoff retries before a site counts as down). **Up** = the server answered with a status below 500
within 15 s. Probes run from GitHub Actions runners (outside Egypt), so sites that block foreign traffic aren't listed.

_Last check: ${summary.generatedAt}_

|  | Site | Category | Today | 7 days | 30 days | p95 (7d) |
|---|---|---|---|---|---|---|
${rows}

## Recent incidents

| Site | Started (UTC) | Resolved (UTC) | Cause |
|---|---|---|---|
${incidentRows}
`;
}
