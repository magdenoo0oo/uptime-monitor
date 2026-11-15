// Serializers decide exactly what leaves the API: string ids, no passwords,
// no __v. They work on both documents and lean objects.

const id = (v) => (v == null ? null : String(v._id ?? v));

export function serializeUser(user) {
  return {
    id: id(user),
    name: user.name,
    email: user.email,
    alertsEnabled: user.alertsEnabled,
    statusPageSlug: user.statusPageSlug ?? null,
    createdAt: user.createdAt,
  };
}

export function serializeMonitor(monitor, extra = {}) {
  return {
    id: id(monitor),
    name: monitor.name,
    url: monitor.url,
    method: monitor.method,
    intervalMinutes: monitor.intervalMinutes,
    timeoutMs: monitor.timeoutMs,
    acceptedStatus: { min: monitor.acceptedStatus.min, max: monitor.acceptedStatus.max },
    keyword: monitor.keyword ?? null,
    public: monitor.public,
    paused: monitor.paused,
    status: monitor.paused ? 'paused' : monitor.status,
    statusChangedAt: monitor.statusChangedAt ?? null,
    lastCheck: monitor.lastCheckedAt
      ? {
          at: monitor.lastCheckedAt,
          statusCode: monitor.lastStatusCode ?? null,
          responseTimeMs: monitor.lastResponseTimeMs ?? null,
          error: monitor.lastError ?? null,
        }
      : null,
    createdAt: monitor.createdAt,
    ...extra,
  };
}

export function serializeCheck(check) {
  return {
    at: check.timestamp,
    up: check.up,
    statusCode: check.statusCode ?? null,
    responseTimeMs: check.responseTimeMs ?? null,
    error: check.error ?? null,
    attempts: check.attempts ?? 1,
  };
}

export function serializeAlert(alert) {
  return {
    id: id(alert),
    type: alert.type,
    channel: alert.channel,
    to: alert.to,
    status: alert.status,
    attempts: alert.attempts,
    lastError: alert.lastError ?? null,
    sentAt: alert.sentAt ?? null,
    createdAt: alert.createdAt,
  };
}

export function serializeIncident(incident, alerts = []) {
  const end = incident.resolvedAt ?? new Date();
  return {
    id: id(incident),
    monitorId: id(incident.monitor),
    ongoing: incident.isOpen,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt ?? null,
    resolution: incident.resolution ?? null,
    durationMs: end - incident.startedAt,
    cause: incident.cause,
    statusCode: incident.statusCode ?? null,
    alerts: alerts.map(serializeAlert),
  };
}
