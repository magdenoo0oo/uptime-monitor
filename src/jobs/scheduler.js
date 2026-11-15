import { logger } from '../config/logger.js';
import { Monitor } from '../models/Monitor.js';
import { JOB, getAgenda } from './agenda.js';

/**
 * Each monitor gets ONE repeating Agenda job, identified by
 * unique({ 'data.monitorId' }). Saving it again updates the same job (e.g. a
 * new interval) instead of creating a second one.
 *
 * Note: agenda.every() can't be used here, it allows only one job per name.
 */
export async function scheduleMonitor(monitor, { insertOnly = false } = {}) {
  const monitorId = String(monitor._id);
  if (monitor.paused) return unscheduleMonitor(monitorId);

  await getAgenda()
    .create(JOB.CHECK, { monitorId })
    .unique({ 'data.monitorId': monitorId }, { insertOnly })
    .repeatEvery(`${monitor.intervalMinutes} minutes`)
    .save();
}

export async function unscheduleMonitor(monitorId) {
  await getAgenda().cancel({ name: JOB.CHECK, data: { monitorId: String(monitorId) } });
}

/**
 * Runs when the worker starts: makes sure every active monitor has a job and
 * removes jobs whose monitor is gone or paused. `insertOnly` leaves existing
 * jobs untouched, so restarting the worker doesn't push back their next run.
 */
export async function reconcileSchedules() {
  const agenda = getAgenda();
  const monitors = await Monitor.find({ paused: false }).select('intervalMinutes paused').lean();
  for (const monitor of monitors) await scheduleMonitor(monitor, { insertOnly: true });

  const active = new Set(monitors.map((m) => String(m._id)));
  const { jobs } = await agenda.queryJobs({ name: JOB.CHECK, limit: 100_000 });
  const orphans = jobs.filter((job) => !active.has(job.data?.monitorId));
  for (const job of orphans) await agenda.cancel({ id: job._id });

  logger.info({ scheduled: monitors.length, removedOrphans: orphans.length }, 'Monitor schedules reconciled');
}
