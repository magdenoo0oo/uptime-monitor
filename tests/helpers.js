import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { setMailTransport } from '../src/alerts/mailer.js';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { getAgenda } from '../src/jobs/agenda.js';
import { initJobs, startWorker } from '../src/jobs/index.js';
import { Monitor } from '../src/models/Monitor.js';

/**
 * A fake website whose behaviour each test controls:
 *   site.respond('/health', { status: 500 }, { status: 500 }, { status: 200 })
 * Responses are served in order; the last one repeats forever.
 */
export async function startFakeSite() {
  const routes = new Map();
  const hits = new Map();
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const queue = routes.get(path) ?? [{ status: 404, body: 'not found' }];
    const { status = 200, body = 'OK', delayMs = 0 } = queue.length > 1 ? queue.shift() : queue[0];
    setTimeout(() => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    }, delayMs);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: (path) => `${base}${path}`,
    respond: (path, ...responses) => routes.set(path, responses),
    hits: (path) => hits.get(path) ?? 0,
    reset: () => {
      routes.clear();
      hits.clear();
    },
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Captures emails instead of sending them; can simulate SMTP failures. */
export function createMailbox() {
  const box = { sent: [], failNext: 0, failAlways: false, attempts: 0 };
  setMailTransport({
    async sendMail(message) {
      box.attempts += 1;
      if (box.failAlways || box.failNext > 0) {
        box.failNext = Math.max(0, box.failNext - 1);
        throw new Error('SMTP connection refused');
      }
      box.sent.push(message);
      return { messageId: `test-${box.sent.length}` };
    },
  });
  box.reset = () => Object.assign(box, { sent: [], failNext: 0, failAlways: false, attempts: 0 });
  return box;
}

/** Real app + in-memory MongoDB + a running Agenda worker. */
export async function startTestServer() {
  const mongo = await MongoMemoryServer.create();
  await connectDB(mongo.getUri());
  await initJobs({ db: mongoose.connection.db });
  await startWorker();

  const app = createApp();
  const site = await startFakeSite();
  const mailbox = createMailbox();

  return {
    app,
    site,
    mailbox,
    api: () => request(app),
    jobs: () => mongoose.connection.db.collection('jobs'),
    async reset() {
      site.reset();
      mailbox.reset();
      await Promise.all([
        ...Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
        mongoose.connection.db.collection('jobs').deleteMany({}),
      ]);
    },
    async stop() {
      await getAgenda().stop();
      await site.close();
      await disconnectDB();
      await mongo.stop();
    },
  };
}

let counter = 0;

export async function registerUser(ctx, overrides = {}) {
  counter += 1;
  const body = { name: `User ${counter}`, email: `user${counter}@test.dev`, password: 'password123', ...overrides };
  const res = await ctx.api().post('/api/v1/auth/register').send(body).expect(201);
  return { ...res.body, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

/**
 * Creates a monitor directly in the DB, WITHOUT scheduling a job, so a test
 * can drive checks by hand with runCheck() and nothing runs behind its back.
 */
export function insertMonitor(owner, overrides = {}) {
  return Monitor.create({
    owner: owner.user?.id ?? owner,
    name: 'Fake site',
    url: 'http://127.0.0.1:1/',
    intervalMinutes: 5,
    timeoutMs: 2000,
    ...overrides,
  });
}

/** Polls until `fn` returns a truthy value (or throws after `timeoutMs`). */
export async function waitFor(fn, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out (last value: ${JSON.stringify(last)})`);
}
