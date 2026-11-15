/**
 * Daily data-run planner (same design as egypt-pulse). Decides whether this run of .github/workflows/collect.yml
 * should probe the sites and commit the results.
 *
 * Each UTC day gets its own plan, derived deterministically from the date (same date -> same plan on every runner):
 *   - a count N between MIN and MAX (default 20..30), so the number of checks varies from day to day;
 *   - N slot times spread over 00:10-22:50 UTC (stratified with jitter: one slot per equal segment, slots at least
 *     half a segment apart), leaving the end of the day free to catch up on slots a dropped cron missed.
 *
 * A run is due when fewer data commits exist today than slots that have already passed ("catch-up quota").
 * The schedule fires far more often than N, so dropped or late GitHub crons are absorbed: the next run that
 * fires takes over the missed slot. Guards: never more than N per day, never two within MIN_SPACING minutes,
 * one commit per run. Plain JS, no dependencies, so a run that is not due exits before `npm ci`.
 *
 *   node scripts/plan.mjs --done <commits today> [--last <unix seconds of last data commit>] [--now <ISO>] [--force]
 *   node scripts/plan.mjs --show [YYYY-MM-DD]     -> print a day's plan
 * Prints key=value lines (append them to $GITHUB_OUTPUT). Tunable with repo variables PLAN_MIN / PLAN_MAX.
 */

import { pathToFileURL } from "node:url";

const WINDOW_START = 10; // 00:10 UTC
const WINDOW_END = 22 * 60 + 50; // 22:50 UTC
const MIN_SPACING = 8; // minimum minutes between two actual data commits (unless forced)
const HARD_MAX = 40; // ceiling for PLAN_MAX
const DEFAULT = { min: 20, max: 30 };

function bounds(env = process.env) {
  const min = Number.parseInt(env.PLAN_MIN ?? "", 10);
  const max = Number.parseInt(env.PLAN_MAX ?? "", 10);
  const ok = Number.isInteger(min) && Number.isInteger(max) && min >= 1 && min <= max && max <= HARD_MAX;
  return ok ? { min, max } : DEFAULT;
}

/** FNV-1a 32-bit hash -> seed. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG in [0, 1). */
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The plan for one UTC date: sorted slot times in minutes after midnight. */
export function planFor(date, { min, max } = bounds()) {
  const rand = rng(hash(`uptime-monitor:${date}`));
  const n = min + Math.floor(rand() * (max - min + 1));
  const seg = (WINDOW_END - WINDOW_START) / n;
  const gap = Math.min(30, seg / 2); // minimum minutes between two planned slots
  const slots = [];
  for (let i = 0; i < n; i++) slots.push(Math.round(WINDOW_START + i * seg + gap / 2 + rand() * (seg - gap)));
  return slots;
}

/** Pure decision: is this run due? */
export function decide({ now, done, last, force = false, limits = bounds() }) {
  const date = now.toISOString().slice(0, 10);
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const slots = planFor(date, limits);
  const target = slots.filter((s) => s <= minute).length;
  const base = { date, planned: slots.length, target, done };
  if (force) return { ...base, due: true, reason: "forced (manual run)" };
  if (done >= slots.length) return { ...base, due: false, reason: "today's plan is complete" };
  if (done >= target) return { ...base, due: false, reason: "no slot due yet" };
  if (last && (now.getTime() / 1000 - last) / 60 < MIN_SPACING) return { ...base, due: false, reason: `last data commit under ${MIN_SPACING} min ago` };
  return { ...base, due: true, reason: target - done > 1 ? `catching up (${target - done} slots behind)` : "slot due" };
}

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--show")) {
    const date = arg("--show") ?? new Date().toISOString().slice(0, 10);
    const slots = planFor(date);
    console.log(`${date}: ${slots.length} slots (UTC) ${slots.map(hhmm).join(" ")}`);
  } else {
    const nowArg = arg("--now");
    const now = nowArg ? new Date(nowArg) : new Date();
    const done = Number.parseInt(arg("--done") ?? "", 10);
    const last = Number.parseInt(arg("--last") ?? "", 10);
    if (Number.isNaN(now.getTime()) || !Number.isInteger(done) || done < 0) {
      // Fail open: if the inputs are broken, a run that commits once is safer than a day with no check at all.
      console.log("due=true");
      console.log("reason=planner inputs unreadable, running anyway");
    } else {
      const d = decide({ now, done, last: Number.isInteger(last) ? last : undefined, force: process.argv.includes("--force") });
      for (const [k, v] of Object.entries(d)) console.log(`${k}=${v}`);
      const slots = planFor(d.date);
      console.error(`plan ${d.date}: ${slots.map(hhmm).join(" ")}`);
    }
  }
}
