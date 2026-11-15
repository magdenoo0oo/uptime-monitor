import { z } from 'zod';
import { loginSchema, refreshSchema, registerSchema } from '../modules/auth/auth.routes.js';
import {
  checksQuery,
  createMonitorSchema,
  incidentsQuery,
  responseTimesQuery,
  statsQuery,
  updateMonitorSchema,
} from '../modules/monitors/monitors.schemas.js';
import { updateMeSchema } from '../modules/users/users.routes.js';

/**
 * OpenAPI 3.1 spec. Request bodies and query params are generated from the
 * same Zod schemas the routes validate with, so the docs can't drift from the
 * real validation rules. Response shapes mirror src/utils/serializers.js.
 */

// ── Zod → JSON Schema ────────────────────────────────────────────────────────

function fromZod(schema) {
  // io: 'input' documents what the client sends (fields with defaults are optional).
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  return jsonSchema;
}

const jsonBody = (schema, description) => ({
  required: true,
  description,
  content: { 'application/json': { schema: fromZod(schema) } },
});

function queryParams(schema) {
  const { properties, required = [] } = fromZod(schema);
  return Object.entries(properties).map(([name, s]) => ({ name, in: 'query', required: required.includes(name), schema: s }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (description, schema) => ({ description, content: { 'application/json': { schema } } });
const err = (name) => ({ $ref: `#/components/responses/${name}` });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const dateTime = { type: 'string', format: 'date-time' };
const nullableDate = nullable('string', { format: 'date-time' });
const percent = nullable('number', { description: 'Percentage with 3 decimals, null when there are no checks' });

const monitorId = { name: 'id', in: 'path', required: true, schema: ref('ObjectId'), description: 'Monitor id' };
const pageOf = (item) =>
  object({
    data: { type: 'array', items: item },
    pageInfo: object({ hasMore: { type: 'boolean' }, nextCursor: nullable('string') }),
  });

const secured = [{ bearerAuth: [] }];
const authErrors = { 401: err('Unauthorized') };
const monitorErrors = { 400: err('BadRequest'), 401: err('Unauthorized'), 404: err('NotFound') };

const description = `
Uptime monitoring backend: users add URLs, a background worker checks them on a schedule,
opens incidents and emails alerts when a site goes down or recovers.

**Auth flow:** \`POST /api/v1/auth/register\` or \`/login\` → click **Authorize** and paste the \`accessToken\`.
Access tokens last 15 minutes; get a new pair with \`POST /api/v1/auth/refresh\`.

**How checks work**
- Every monitor has its own repeating background job (Agenda, stored in MongoDB). The first check runs right after creation.
- A failing check is retried with exponential backoff (2s, 4s… ±20% jitter) before the monitor is marked **down**, to avoid false alarms.
- \`pending/up → down\` opens an incident and queues a "down" email; \`down → up\` resolves it and queues a "recovered" email.
- Emails are sent by a separate job with its own exponential-backoff retries, so a broken SMTP server never delays checks.
- Every check result is stored in a MongoDB **time-series collection** and deleted automatically after the retention period.
`;

export const openapiSpec = {
  openapi: '3.1.0',
  info: { title: 'Uptime Monitor API', version: '1.0.0', description },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Auth' },
    { name: 'Users' },
    { name: 'Monitors', description: 'CRUD and on-demand tests' },
    { name: 'Analytics', description: 'Uptime, response times, check history, incidents' },
    { name: 'Status page', description: 'Public, no auth' },
    { name: 'System' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: {
          200: json('Healthy', object({ status: { const: 'ok' }, db: { const: 'up' } })),
          503: json('Database unreachable', object({ status: { const: 'degraded' }, db: { const: 'down' } })),
        },
      },
    },

    '/api/v1/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account',
        requestBody: jsonBody(registerSchema),
        responses: { 201: json('Registered', ref('AuthResponse')), 400: err('BadRequest'), 409: err('Conflict') },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in',
        requestBody: jsonBody(loginSchema),
        responses: { 200: json('Logged in', ref('AuthResponse')), 400: err('BadRequest'), 401: err('Unauthorized'), 429: err('RateLimited') },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate tokens',
        description: 'Each refresh token works once. Replaying a used one revokes the whole session.',
        requestBody: jsonBody(refreshSchema),
        responses: { 200: json('New token pair', ref('Tokens')), 401: err('Unauthorized') },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke the session of this refresh token',
        requestBody: jsonBody(refreshSchema),
        responses: { 204: { description: 'Logged out' } },
      },
    },

    '/api/v1/users/me': {
      get: {
        tags: ['Users'],
        summary: 'My profile',
        security: secured,
        responses: { 200: json('Profile', object({ user: ref('User') })), ...authErrors },
      },
      patch: {
        tags: ['Users'],
        summary: 'Update profile, alert settings or status page slug',
        description: 'Set `statusPageSlug` to publish `/api/v1/status/{slug}`; set it to `null` to unpublish.',
        security: secured,
        requestBody: jsonBody(updateMeSchema),
        responses: { 200: json('Updated', object({ user: ref('User') })), 400: err('BadRequest'), 409: err('Conflict'), ...authErrors },
      },
    },

    '/api/v1/monitors': {
      get: {
        tags: ['Monitors'],
        summary: 'List my monitors with their current status and 24h uptime',
        security: secured,
        responses: {
          200: json('Monitors', object({ data: { type: 'array', items: ref('MonitorWithUptime') } })),
          ...authErrors,
        },
      },
      post: {
        tags: ['Monitors'],
        summary: 'Create a monitor',
        description: 'The first check runs immediately, then every `intervalMinutes`. Private/internal addresses are rejected (SSRF protection).',
        security: secured,
        requestBody: jsonBody(createMonitorSchema),
        responses: { 201: json('Created', object({ monitor: ref('Monitor') })), 400: err('BadRequest'), ...authErrors },
      },
    },
    '/api/v1/monitors/{id}': {
      parameters: [monitorId],
      get: {
        tags: ['Monitors'],
        summary: 'Get a monitor',
        security: secured,
        responses: { 200: json('Monitor', object({ monitor: ref('Monitor') })), ...monitorErrors },
      },
      patch: {
        tags: ['Monitors'],
        summary: 'Update, pause or resume a monitor',
        description:
          'Changing the URL, method, timeout, accepted status or keyword, or pausing/resuming, resets the status to `pending` and closes any open incident.',
        security: secured,
        requestBody: jsonBody(updateMonitorSchema),
        responses: { 200: json('Updated', object({ monitor: ref('Monitor') })), ...monitorErrors },
      },
      delete: {
        tags: ['Monitors'],
        summary: 'Delete a monitor with its checks, incidents and alerts',
        security: secured,
        responses: { 204: { description: 'Deleted' }, ...monitorErrors },
      },
    },
    '/api/v1/monitors/{id}/check': {
      parameters: [monitorId],
      post: {
        tags: ['Monitors'],
        summary: 'Run a real check now',
        description:
          'Same as a scheduled check: uses backoff retries, is saved to history, and can open/resolve an incident and send alerts.',
        security: secured,
        responses: {
          200: json(
            'Check result',
            object({
              result: { allOf: [ref('ProbeResult'), object({ attempts: { type: 'integer' } })] },
              transition: { enum: ['unchanged', 'went-down', 'recovered', 'stale'] },
              monitor: ref('Monitor'),
            }),
          ),
          ...monitorErrors,
        },
      },
    },
    '/api/v1/monitors/{id}/test': {
      parameters: [monitorId],
      post: {
        tags: ['Monitors'],
        summary: 'Probe now (no side effects)',
        description: 'Runs a single request right now. Nothing is saved and no alerts are sent.',
        security: secured,
        responses: { 200: json('Probe result', object({ result: ref('ProbeResult'), checkedAt: dateTime })), ...monitorErrors },
      },
    },
    '/api/v1/monitors/{id}/stats': {
      parameters: [monitorId],
      get: {
        tags: ['Analytics'],
        summary: 'Uptime %, response-time percentiles and downtime for a period',
        security: secured,
        parameters: queryParams(statsQuery),
        responses: { 200: json('Stats', ref('Stats')), ...monitorErrors },
      },
    },
    '/api/v1/monitors/{id}/response-times': {
      parameters: [monitorId],
      get: {
        tags: ['Analytics'],
        summary: 'Response-time series for charts',
        description: 'Default bucket: 24h→1h, 7d→6h, 30d/90d→1d. At most 1000 points.',
        security: secured,
        parameters: queryParams(responseTimesQuery),
        responses: { 200: json('Series', ref('ResponseTimeSeries')), ...monitorErrors },
      },
    },
    '/api/v1/monitors/{id}/checks': {
      parameters: [monitorId],
      get: {
        tags: ['Analytics'],
        summary: 'Raw check history, newest first',
        description: 'Cursor pagination: pass `pageInfo.nextCursor` as `cursor`.',
        security: secured,
        parameters: queryParams(checksQuery),
        responses: { 200: json('Checks', pageOf(ref('Check'))), ...monitorErrors },
      },
    },
    '/api/v1/monitors/{id}/incidents': {
      parameters: [monitorId],
      get: {
        tags: ['Analytics'],
        summary: 'Outages with the alerts sent for each',
        security: secured,
        parameters: queryParams(incidentsQuery),
        responses: { 200: json('Incidents', pageOf(ref('Incident'))), ...monitorErrors },
      },
    },

    '/api/v1/status/{slug}': {
      get: {
        tags: ['Status page'],
        summary: 'Public status page',
        description: 'Only monitors marked `public`. URLs are never exposed.',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: json('Status page', ref('StatusPage')), 404: err('NotFound') },
      },
    },
  },

  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      ObjectId: { type: 'string', pattern: '^[a-f0-9]{24}$', example: '6afa1b388f91259f6f07dfaf' },
      Error: object({
        error: object(
          {
            code: { type: 'string', example: 'VALIDATION_ERROR' },
            message: { type: 'string' },
            details: { type: 'array', items: object({ path: { type: 'string' }, message: { type: 'string' } }) },
          },
          ['code', 'message'],
        ),
      }),
      Tokens: object({ accessToken: { type: 'string' }, refreshToken: { type: 'string' } }),
      AuthResponse: object({ user: ref('User'), accessToken: { type: 'string' }, refreshToken: { type: 'string' } }),
      User: object({
        id: ref('ObjectId'),
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        alertsEnabled: { type: 'boolean' },
        statusPageSlug: nullable('string'),
        createdAt: dateTime,
      }),
      Monitor: object({
        id: ref('ObjectId'),
        name: { type: 'string' },
        url: { type: 'string', format: 'uri' },
        method: { enum: ['GET', 'HEAD'] },
        intervalMinutes: { type: 'integer' },
        timeoutMs: { type: 'integer' },
        acceptedStatus: object({ min: { type: 'integer' }, max: { type: 'integer' } }),
        keyword: nullable('string'),
        public: { type: 'boolean' },
        paused: { type: 'boolean' },
        status: { enum: ['pending', 'up', 'down', 'paused'] },
        statusChangedAt: nullableDate,
        lastCheck: {
          anyOf: [
            object({
              at: dateTime,
              statusCode: nullable('integer'),
              responseTimeMs: nullable('integer'),
              error: nullable('string'),
            }),
            { type: 'null' },
          ],
        },
        createdAt: dateTime,
      }),
      MonitorWithUptime: { allOf: [ref('Monitor'), object({ uptime24h: percent })] },
      ProbeResult: object({
        up: { type: 'boolean' },
        statusCode: nullable('integer'),
        responseTimeMs: nullable('integer'),
        error: nullable('string', { example: 'Timeout after 10000ms' }),
      }),
      Check: object({
        at: dateTime,
        up: { type: 'boolean' },
        statusCode: nullable('integer'),
        responseTimeMs: nullable('integer'),
        error: nullable('string'),
        attempts: { type: 'integer', description: 'Probes made, including backoff retries' },
      }),
      Alert: object({
        id: ref('ObjectId'),
        type: { enum: ['down', 'recovered'] },
        channel: { const: 'email' },
        to: { type: 'string' },
        status: { enum: ['queued', 'sent', 'failed'] },
        attempts: { type: 'integer' },
        lastError: nullable('string'),
        sentAt: nullableDate,
        createdAt: dateTime,
      }),
      Incident: object({
        id: ref('ObjectId'),
        monitorId: ref('ObjectId'),
        ongoing: { type: 'boolean' },
        startedAt: dateTime,
        resolvedAt: nullableDate,
        resolution: { enum: ['recovered', 'paused', null] },
        durationMs: { type: 'integer' },
        cause: { type: 'string' },
        statusCode: nullable('integer'),
        alerts: { type: 'array', items: ref('Alert') },
      }),
      Stats: object({
        period: { enum: ['24h', '7d', '30d', '90d'] },
        from: dateTime,
        to: dateTime,
        checks: { type: 'integer' },
        upChecks: { type: 'integer' },
        uptimePercent: percent,
        responseTimeMs: object(
          Object.fromEntries(['avg', 'min', 'max', 'p50', 'p95', 'p99'].map((k) => [k, nullable('integer')])),
        ),
        incidents: { type: 'integer' },
        downtimeMs: { type: 'integer' },
      }),
      ResponseTimeSeries: object({
        period: { type: 'string' },
        bucket: { type: 'string' },
        data: {
          type: 'array',
          items: object({
            time: dateTime,
            checks: { type: 'integer' },
            uptimePercent: percent,
            avgMs: nullable('integer'),
            p95Ms: nullable('integer'),
          }),
        },
      }),
      StatusPage: object({
        page: object({ title: { type: 'string' }, slug: { type: 'string' } }),
        overall: { enum: ['operational', 'partial_outage', 'major_outage'] },
        monitors: {
          type: 'array',
          items: object({
            name: { type: 'string' },
            status: { enum: ['pending', 'up', 'down', 'paused'] },
            lastCheckedAt: nullableDate,
            uptime30d: percent,
            days: { type: 'array', items: object({ date: { type: 'string', format: 'date' }, uptimePercent: percent }) },
          }),
        },
        generatedAt: dateTime,
      }),
    },
    responses: {
      BadRequest: json('Invalid input', ref('Error')),
      Unauthorized: json('Missing or invalid token', ref('Error')),
      NotFound: json('Not found (or not yours)', ref('Error')),
      Conflict: json('Already exists', ref('Error')),
      RateLimited: json('Too many attempts', ref('Error')),
    },
  },
};
