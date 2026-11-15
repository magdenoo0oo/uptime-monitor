import { describe, expect, it } from 'vitest';
import { nextDaily, nextIncidents, nextLatest, percentile, statusMarkdown, summarize } from '../src/collector/state.js';
import { decide, planFor } from '../scripts/plan.mjs';

const targets = [
  { id: 'a', name: 'Site A', category: 'Banks', url: 'https://a.example' },
  { id: 'b', name: 'Site B', category: 'News', url: 'https://b.example' },
];
const up = (ms) => ({ up: true, statusCode: 200, responseTimeMs: ms, error: null, attempts: 1 });
const down = (error) => ({ up: false, statusCode: null, responseTimeMs: null, error, attempts: 3 });

function run(state, results, checkedAt) {
  const latest = nextLatest(state.latest, targets, results, checkedAt);
  return {
    latest,
    daily: nextDaily(state.daily, checkedAt.slice(0, 10), latest),
    incidents: nextIncidents(state.incidents, state.latest, latest),
  };
}

describe('collector state', () => {
  it('tracks status, "since", daily counters and incidents across rounds', () => {
    let s = { latest: null, daily: null, incidents: [] };
    s = run(s, [up(100), up(300)], '2026-11-16T01:00:00Z');
    s = run(s, [down('Timeout after 15000ms'), up(500)], '2026-11-16T02:00:00Z');
    s = run(s, [down('Connection refused'), up(200)], '2026-11-16T03:00:00Z');
    s = run(s, [up(120), up(400)], '2026-11-16T04:00:00Z');

    const a = s.latest.sites.find((x) => x.id === 'a');
    const b = s.latest.sites.find((x) => x.id === 'b');
    expect(a).toMatchObject({ status: 'up', since: '2026-11-16T04:00:00Z' });
    expect(b).toMatchObject({ status: 'up', since: '2026-11-16T01:00:00Z' });

    expect(s.daily.sites.a).toEqual({
      checks: 4,
      up: 2,
      responseTimesMs: [100, 120],
      errors: { 'Timeout after 15000ms': 1, 'Connection refused': 1 },
    });

    expect(s.incidents).toEqual([
      { site: 'a', startedAt: '2026-11-16T02:00:00Z', resolvedAt: '2026-11-16T04:00:00Z', cause: 'Timeout after 15000ms' },
    ]);
  });

  it('summarizes today / 7d / 30d and renders a status table', () => {
    let s = { latest: null, daily: null, incidents: [] };
    s = run(s, [up(100), down('DNS lookup failed')], '2026-11-16T01:00:00Z');
    s = run(s, [up(300), down('DNS lookup failed')], '2026-11-16T02:00:00Z');
    const yesterday = { date: '2026-11-15', sites: { a: { checks: 2, up: 1, responseTimesMs: [200], errors: {} } } };

    const summary = summarize(targets, [s.daily, yesterday], s.latest);
    const a = summary.sites.find((x) => x.id === 'a');
    expect(a.today).toEqual({ checks: 2, uptimePercent: 100, avgMs: 200, p95Ms: 300 });
    expect(a['7d']).toEqual({ checks: 4, uptimePercent: 75, avgMs: 200, p95Ms: 300 });
    expect(summary.sites.find((x) => x.id === 'b').today.uptimePercent).toBe(0);

    const md = statusMarkdown(summary, s.incidents);
    expect(md).toContain('| 🟢 | Site A | Banks | 100% | 75.00% | 75.00% | 300 ms |');
    expect(md).toContain('| Site B | 2026-11-16T01:00:00Z | ongoing | DNS lookup failed |');
  });

  it('percentile', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95)).toBe(95);
  });
});

describe('daily planner (scripts/plan.mjs)', () => {
  it('plans 20–30 checks a day, the same plan on every runner', () => {
    const plan = planFor('2026-11-16');
    expect(plan.length).toBeGreaterThanOrEqual(20);
    expect(plan.length).toBeLessThanOrEqual(30);
    expect(planFor('2026-11-16')).toEqual(plan);
    expect(plan).toEqual([...plan].sort((x, y) => x - y));
  });

  it('is due only when behind the plan, catches up, and never exceeds it', () => {
    const plan = planFor('2026-11-16');
    const noon = new Date('2026-11-16T12:00:00Z');
    const passed = plan.filter((m) => m <= 12 * 60).length;

    expect(decide({ now: noon, done: passed }).due).toBe(false);
    expect(decide({ now: noon, done: passed - 2 })).toMatchObject({ due: true, reason: 'catching up (2 slots behind)' });
    expect(decide({ now: noon, done: plan.length }).due).toBe(false);
    expect(decide({ now: noon, done: 0, last: noon.getTime() / 1000 - 60 }).due).toBe(false); // 8-min spacing
    expect(decide({ now: noon, done: plan.length, force: true }).due).toBe(true);
  });
});
