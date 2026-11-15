import { probe } from '../../checks/probe.js';
import { runCheck } from '../../checks/runCheck.js';
import { BlockedAddressError, assertPublicUrl } from '../../checks/safeNetwork.js';
import { env } from '../../config/env.js';
import { scheduleMonitor, unscheduleMonitor } from '../../jobs/scheduler.js';
import { Alert } from '../../models/Alert.js';
import { Check } from '../../models/Check.js';
import { Incident } from '../../models/Incident.js';
import { Monitor } from '../../models/Monitor.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { serializeCheck, serializeIncident, serializeMonitor } from '../../utils/serializers.js';
import { periodStart } from '../../utils/validation.js';
import { uptimeByMonitor } from './stats.service.js';

// Changing any of these means "a different check", so the current state and
// any open incident no longer apply.
const TARGET_FIELDS = ['url', 'method', 'timeoutMs', 'acceptedStatus', 'keyword'];

function assertUrlAllowed(url) {
  if (env.ALLOW_PRIVATE_TARGETS) return;
  try {
    assertPublicUrl(url);
  } catch (err) {
    if (err instanceof BlockedAddressError) throw badRequest(err.message);
    throw err;
  }
}

/** Loads a monitor only if `userId` owns it. 404 otherwise. */
export async function getOwnedMonitor(userId, monitorId) {
  const monitor = await Monitor.findOne({ _id: monitorId, owner: userId }).lean();
  if (!monitor) throw notFound('Monitor not found');
  return monitor;
}

async function closeOpenIncident(monitorId, resolution) {
  await Incident.updateOne(
    { monitor: monitorId, isOpen: true },
    { $set: { isOpen: false, resolvedAt: new Date(), resolution } },
  );
}

export async function listMonitors(userId) {
  const monitors = await Monitor.find({ owner: userId }).sort({ createdAt: -1 }).lean();
  const uptimes = await uptimeByMonitor(
    monitors.map((m) => m._id),
    periodStart('24h'),
  );
  return monitors.map((m) => serializeMonitor(m, { uptime24h: uptimes.get(String(m._id)) ?? null }));
}

export async function createMonitor(userId, data) {
  assertUrlAllowed(data.url);
  const count = await Monitor.countDocuments({ owner: userId });
  if (count >= env.MAX_MONITORS_PER_USER) {
    throw badRequest(`You can have at most ${env.MAX_MONITORS_PER_USER} monitors`);
  }

  const monitor = await Monitor.create({ ...data, owner: userId });
  // A new repeating job runs immediately, then every intervalMinutes.
  await scheduleMonitor(monitor);
  return serializeMonitor(monitor.toObject());
}

export async function updateMonitor(userId, monitorId, patch) {
  const current = await getOwnedMonitor(userId, monitorId);
  if (patch.url) assertUrlAllowed(patch.url);
  if ((patch.keyword ?? current.keyword) && (patch.method ?? current.method) === 'HEAD') {
    throw badRequest('Keyword checks need the GET method (HEAD has no body)');
  }

  const set = { ...patch };
  const targetChanged = TARGET_FIELDS.some((f) => f in patch);
  const pausing = patch.paused === true && !current.paused;
  const resuming = patch.paused === false && current.paused;

  // Start fresh: the next check decides up/down without sending a misleading
  // "recovered" email for the old configuration.
  if (targetChanged || pausing || resuming) {
    set.status = 'pending';
    set.statusChangedAt = new Date();
    await closeOpenIncident(current._id, 'paused');
  }

  const monitor = await Monitor.findOneAndUpdate(
    { _id: current._id, owner: userId },
    { $set: set, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!monitor) throw notFound('Monitor not found');

  if (pausing || resuming || 'intervalMinutes' in patch) await scheduleMonitor(monitor);
  return serializeMonitor(monitor);
}

export async function deleteMonitor(userId, monitorId) {
  const monitor = await Monitor.findOneAndDelete({ _id: monitorId, owner: userId }).lean();
  if (!monitor) throw notFound('Monitor not found');
  await unscheduleMonitor(monitor._id);
  await Promise.all([
    Check.deleteMany({ monitor: monitor._id }),
    Incident.deleteMany({ monitor: monitor._id }),
    Alert.deleteMany({ monitor: monitor._id }),
  ]);
}

/**
 * A real check, right now: saved to history, can open/resolve incidents and
 * send alerts, exactly like a scheduled one. Safe to run alongside the
 * scheduled job: the unique open-incident index and the atomic updates make
 * sure a transition (and its email) happens only once.
 */
export async function checkNow(userId, monitorId) {
  const monitor = await getOwnedMonitor(userId, monitorId);
  if (monitor.paused) throw badRequest('Monitor is paused');
  const { result, transition } = await runCheck(monitor._id);
  return { result, transition, monitor: serializeMonitor(await getOwnedMonitor(userId, monitorId)) };
}

/** One-off probe with no side effects: nothing is saved, no alerts. */
export async function testMonitor(userId, monitorId) {
  const monitor = await getOwnedMonitor(userId, monitorId);
  return { result: await probe(monitor), checkedAt: new Date() };
}

export async function listChecks(monitor, { limit, cursor }) {
  const filter = { monitor: monitor._id };
  if (cursor) filter.timestamp = { $lt: new Date(cursor) };
  const docs = await Check.find(filter).sort({ timestamp: -1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  return {
    data: page.map(serializeCheck),
    pageInfo: { hasMore, nextCursor: hasMore ? page.at(-1).timestamp.toISOString() : null },
  };
}

export async function listIncidents(monitor, { limit, cursor }) {
  const filter = { monitor: monitor._id };
  if (cursor) filter._id = { $lt: cursor };
  const docs = await Incident.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);

  const alerts = await Alert.find({ incident: { $in: page.map((i) => i._id) } }).sort({ _id: 1 }).lean();
  const byIncident = Map.groupBy(alerts, (a) => String(a.incident));

  return {
    data: page.map((i) => serializeIncident(i, byIncident.get(String(i._id)))),
    pageInfo: { hasMore, nextCursor: hasMore ? String(page.at(-1)._id) : null },
  };
}
