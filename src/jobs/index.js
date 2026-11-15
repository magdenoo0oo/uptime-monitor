import { MongoBackend } from '@agendajs/mongo-backend';
import { Agenda, exponential } from 'agenda';
import { deliverAlert, markAlertFailed } from '../alerts/alerts.service.js';
import { runCheck } from '../checks/runCheck.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { JOB, getAgenda, setAgenda } from './agenda.js';
import { reconcileSchedules } from './scheduler.js';

/**
 * Agenda stores jobs in the same MongoDB (collection "jobs"): no Redis, no
 * extra infrastructure. Workers poll for due jobs every JOBS_PROCESS_EVERY_MS
 * and lock them, so several worker processes never run the same job twice.
 */
export async function initJobs({ db }) {
  const agenda = new Agenda({
    backend: new MongoBackend({ mongo: db, collection: 'jobs' }),
    processEvery: env.JOBS_PROCESS_EVERY_MS,
    maxConcurrency: env.CHECK_CONCURRENCY + 10,
  });

  agenda.define(
    JOB.CHECK,
    async (job) => {
      const { skipped } = await runCheck(job.attrs.data.monitorId);
      if (skipped) logger.debug({ monitorId: job.attrs.data.monitorId, skipped }, 'Check skipped');
    },
    {
      concurrency: env.CHECK_CONCURRENCY,
      // Longer than the worst case: (retries + 1) × timeout + backoff waits.
      lockLifetime: 5 * 60 * 1000,
    },
  );

  agenda.define(JOB.ALERT, (job) => deliverAlert(job.attrs.data.alertId), {
    concurrency: 5,
    // Agenda's built-in retry: 30s, 1m, 2m, 4m, 8m (±20% jitter) by default.
    backoff: exponential({ delay: env.ALERT_RETRY_BASE_MS, factor: 2, maxRetries: env.ALERT_MAX_RETRIES, jitter: 0.2 }),
    removeOnComplete: true,
  });

  agenda.on(`retry exhausted:${JOB.ALERT}`, (err, job) => {
    markAlertFailed(job.attrs.data.alertId, err).catch((e) => logger.error({ err: e }, 'markAlertFailed failed'));
  });
  agenda.on('error', (err) => logger.error({ err }, 'Agenda error'));

  await agenda.ready;
  setAgenda(agenda);
  return agenda;
}

/** Start processing jobs in this process (the "worker" role). */
export async function startWorker() {
  await reconcileSchedules();
  await getAgenda().start();
  logger.info({ processEveryMs: env.JOBS_PROCESS_EVERY_MS }, 'Job worker started');
}

/** Graceful stop: let running checks finish (up to 10s), then stop polling. */
export async function stopJobs() {
  const agenda = getAgenda();
  await agenda.drain(10_000);
}
