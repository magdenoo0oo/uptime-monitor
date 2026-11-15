/**
 * Holds the single Agenda instance. Kept separate from the job definitions so
 * services can schedule jobs without importing the job handlers (no cycles).
 */
export const JOB = {
  CHECK: 'check-monitor',
  ALERT: 'send-alert',
};

let agenda = null;

export function setAgenda(instance) {
  agenda = instance;
}

export function getAgenda() {
  if (!agenda) throw new Error('Agenda is not initialised. Call initJobs() first.');
  return agenda;
}
