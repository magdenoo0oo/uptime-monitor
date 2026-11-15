// Monitor names, URLs and error messages come from users or remote servers, so
// they're escaped before going into HTML. Otherwise a monitor named
// "<img src=x onerror=...>" would inject markup into the email.
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(totalSeconds / 86_400);
  const h = Math.floor((totalSeconds % 86_400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, (s || totalSeconds === 0) && `${s}s`].filter(Boolean).join(' ');
}

function layout(color, heading, rows) {
  const cells = rows
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join('');
  return `<div style="font-family:system-ui,sans-serif;max-width:520px">
  <h2 style="color:${color};margin:0 0 12px">${escapeHtml(heading)}</h2>
  <table style="border-collapse:collapse;font-size:14px">${cells}</table>
</div>`;
}

const asText = (heading, rows) => [heading, '', ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n');

export function renderAlert(type, monitor, incident) {
  if (type === 'down') {
    const heading = `${monitor.name} is DOWN`;
    const rows = [
      ['URL', monitor.url],
      ['Reason', incident.cause],
      ['Since', incident.startedAt.toISOString()],
    ];
    return { subject: `🔴 DOWN: ${monitor.name}`, text: asText(heading, rows), html: layout('#c62828', heading, rows) };
  }

  const downtime = formatDuration(incident.resolvedAt - incident.startedAt);
  const heading = `${monitor.name} is back UP`;
  const rows = [
    ['URL', monitor.url],
    ['Was down for', downtime],
    ['Original reason', incident.cause],
    ['Recovered at', incident.resolvedAt.toISOString()],
  ];
  return {
    subject: `✅ RECOVERED: ${monitor.name} (down ${downtime})`,
    text: asText(heading, rows),
    html: layout('#2e7d32', heading, rows),
  };
}
