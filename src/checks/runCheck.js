import { enqueueAlert } from '../alerts/alerts.service.js';
import { Check } from '../models/Check.js';
import { Incident } from '../models/Incident.js';
import { Monitor } from '../models/Monitor.js';
import { probeWithRetries } from './probe.js';

async function openIncident(monitor, result, at) {
  let incident;
  try {
    incident = await Incident.create({
      monitor: monitor._id,
      owner: monitor.owner,
      startedAt: at,
      cause: result.error,
      statusCode: result.statusCode,
    });
  } catch (err) {
    if (err?.code === 11000) return null; // an incident is already open → don't alert twice
    throw err;
  }
  await enqueueAlert('down', monitor, incident);
  return incident;
}

async function resolveIncident(monitor, at) {
  const incident = await Incident.findOneAndUpdate(
    { monitor: monitor._id, isOpen: true },
    { $set: { isOpen: false, resolvedAt: at, resolution: 'recovered' } },
    { returnDocument: 'after' },
  ).lean();
  if (incident) await enqueueAlert('recovered', monitor, incident);
  return incident;
}

/**
 * Saves the new state and reacts to transitions:
 *   pending/up → down : open an incident + "down" alert
 *   down → up         : resolve the incident + "recovered" alert
 *   anything else     : just update the "last check" fields
 *
 * The update is conditional on `revision` (optimistic concurrency): if the
 * monitor was edited or paused while the check was running, the result
 * belongs to the old configuration and is discarded.
 */
export async function applyResult(monitor, result, checkedAt) {
  const previous = monitor.status;
  const next = result.up ? 'up' : 'down';

  const set = {
    status: next,
    lastCheckedAt: checkedAt,
    lastStatusCode: result.statusCode,
    lastResponseTimeMs: result.responseTimeMs,
    lastError: result.error,
  };
  if (previous !== next) set.statusChangedAt = checkedAt;

  const { matchedCount } = await Monitor.updateOne(
    { _id: monitor._id, revision: monitor.revision, paused: false },
    { $set: set },
  );
  if (matchedCount === 0) return 'stale';

  if (next === 'down' && previous !== 'down') {
    await openIncident(monitor, result, checkedAt);
    return 'went-down';
  }
  if (next === 'up' && previous === 'down') {
    await resolveIncident(monitor, checkedAt);
    return 'recovered';
  }
  return 'unchanged';
}

/** The body of the "check-monitor" job. */
export async function runCheck(monitorId, options) {
  const monitor = await Monitor.findById(monitorId).lean();
  if (!monitor) return { skipped: 'deleted' };
  if (monitor.paused) return { skipped: 'paused' };

  const result = await probeWithRetries(monitor, options);
  const checkedAt = new Date();

  await Check.create({
    timestamp: checkedAt,
    monitor: monitor._id,
    up: result.up,
    statusCode: result.statusCode,
    responseTimeMs: result.responseTimeMs,
    error: result.error,
    attempts: result.attempts,
  });

  const transition = await applyResult(monitor, result, checkedAt);
  return { result, transition };
}
