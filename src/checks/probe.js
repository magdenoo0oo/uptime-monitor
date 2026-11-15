import { request } from 'undici';
import { env } from '../config/env.js';
import { backoffDelay, sleep } from './backoff.js';
import { assertPublicUrl, createDispatcher } from './safeNetwork.js';

const MAX_BODY_BYTES = 1024 * 1024; // keyword search reads at most 1 MB
const dispatcher = createDispatcher({ allowPrivate: env.ALLOW_PRIVATE_TARGETS });

function describeError(err, timeoutMs) {
  const code = err?.code ?? err?.cause?.code;
  if (err?.name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return `Timeout after ${timeoutMs}ms`;
  }
  if (code === 'EBLOCKED') return err.message ?? err.cause.message;
  if (code === 'ECONNREFUSED') return 'Connection refused';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'Connection reset';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS lookup failed';
  if (code?.startsWith?.('ERR_TLS') || code?.includes?.('CERT')) return `TLS error: ${code}`;
  return err?.message ?? 'Unknown error';
}

async function bodyContains(body, keyword) {
  const decoder = new TextDecoder(); // handles UTF-8 characters split across chunks
  let text = '';
  // Leaving the loop early (return/break) closes the stream for us.
  for await (const chunk of body) {
    text += decoder.decode(chunk, { stream: true });
    if (text.includes(keyword)) return true;
    if (text.length > MAX_BODY_BYTES) return false;
  }
  return false;
}

/**
 * Makes ONE request to the monitor's URL.
 * @returns {Promise<{ up: boolean, statusCode: number|null, responseTimeMs: number|null, error: string|null }>}
 */
export async function probe(monitor) {
  const { url, method = 'GET', timeoutMs, acceptedStatus = { min: 200, max: 399 }, keyword } = monitor;
  const started = performance.now();

  try {
    if (!env.ALLOW_PRIVATE_TARGETS) assertPublicUrl(url);

    const res = await request(url, {
      method,
      dispatcher,
      headers: { 'user-agent': 'UptimeMonitor/1.0', accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    // Time to first byte (headers received) is the standard uptime metric.
    const responseTimeMs = Math.round(performance.now() - started);
    const { statusCode, body } = res;
    // Closing a body early makes undici emit an "aborted" error on the stream.
    // With no listener, that error would crash the whole worker process.
    body.on('error', () => {});

    if (statusCode < acceptedStatus.min || statusCode > acceptedStatus.max) {
      await body.dump(); // read & discard (up to 128 KB) so the connection is released
      return { up: false, statusCode, responseTimeMs, error: `Unexpected status ${statusCode}` };
    }
    if (keyword && method === 'GET' && !(await bodyContains(body, keyword))) {
      return { up: false, statusCode, responseTimeMs, error: `Keyword "${keyword}" not found` };
    }
    if (!keyword || method !== 'GET') await body.dump();
    return { up: true, statusCode, responseTimeMs, error: null };
  } catch (err) {
    return { up: false, statusCode: null, responseTimeMs: null, error: describeError(err, timeoutMs) };
  }
}

/**
 * Probes, and if the site looks down, retries with exponential backoff before
 * believing it. One dropped packet shouldn't wake anyone up at 3 AM.
 *
 * Retries only happen when we're *confirming a new outage*. If the monitor is
 * already down, a single probe is enough: we're just waiting for recovery.
 */
export async function probeWithRetries(monitor, { retries = env.CHECK_RETRIES, baseMs = env.CHECK_RETRY_BASE_MS } = {}) {
  const maxAttempts = monitor.status === 'down' ? 1 : retries + 1;
  let result;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await sleep(backoffDelay(attempt - 1, baseMs));
    result = await probe(monitor);
    if (result.up) return { ...result, attempts: attempt + 1 };
  }
  return { ...result, attempts: maxAttempts };
}
