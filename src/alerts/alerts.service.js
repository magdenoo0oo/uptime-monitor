import { logger } from '../config/logger.js';
import { JOB, getAgenda } from '../jobs/agenda.js';
import { Alert } from '../models/Alert.js';
import { Incident } from '../models/Incident.js';
import { Monitor } from '../models/Monitor.js';
import { User } from '../models/User.js';
import { sendMail } from './mailer.js';
import { renderAlert } from './templates.js';

/**
 * Records the alert and queues its delivery as a background job. The check
 * never waits for SMTP: a slow or broken mail server can't delay monitoring.
 */
export async function enqueueAlert(type, monitor, incident) {
  const owner = await User.findById(monitor.owner).select('email alertsEnabled').lean();
  if (!owner?.alertsEnabled) return null;

  const alert = await Alert.create({
    monitor: monitor._id,
    incident: incident._id,
    owner: owner._id,
    type,
    to: owner.email,
  });
  await getAgenda().now(JOB.ALERT, { alertId: String(alert._id) });
  return alert;
}

/**
 * Job handler. Throwing makes Agenda retry the job with exponential backoff
 * (configured in jobs/index.js), so a temporary SMTP outage doesn't lose alerts.
 */
export async function deliverAlert(alertId) {
  const alert = await Alert.findById(alertId);
  if (!alert || alert.status !== 'queued') return;

  const [monitor, incident] = await Promise.all([
    Monitor.findById(alert.monitor).lean(),
    Incident.findById(alert.incident).lean(),
  ]);
  if (!monitor || !incident) {
    alert.status = 'failed';
    alert.lastError = 'Monitor was deleted before the alert was sent';
    await alert.save();
    return;
  }

  alert.attempts += 1;
  try {
    await sendMail({ to: alert.to, ...renderAlert(alert.type, monitor, incident) });
    alert.status = 'sent';
    alert.sentAt = new Date();
    alert.lastError = null;
    await alert.save();
  } catch (err) {
    alert.lastError = err.message;
    await alert.save();
    logger.warn({ alertId, attempt: alert.attempts, err: err.message }, 'Alert delivery failed, will retry');
    throw err;
  }
}

/** Called when Agenda gives up retrying. */
export async function markAlertFailed(alertId, err) {
  await Alert.updateOne({ _id: alertId, status: 'queued' }, { $set: { status: 'failed', lastError: err.message } });
  logger.error({ alertId, err: err.message }, 'Alert delivery failed permanently');
}
