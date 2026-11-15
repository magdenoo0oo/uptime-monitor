/**
 * Exponential backoff with jitter: base, base×2, base×4, ... each ±20% random.
 *
 * The jitter matters: if 1,000 monitors on the same failing host all retried
 * at exactly 2s, 4s, 8s they'd hit it in synchronized waves ("thundering herd").
 */
export function backoffDelay(attempt, baseMs, { factor = 2, jitter = 0.2, maxMs = 60_000 } = {}) {
  const raw = Math.min(baseMs * factor ** attempt, maxMs);
  const spread = raw * jitter;
  return Math.round(raw - spread + Math.random() * spread * 2);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
