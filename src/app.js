import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { corsOrigin } from './config/env.js';
import { logger } from './config/logger.js';
import { openapiSpec } from './docs/openapi.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { monitorRoutes } from './modules/monitors/monitors.routes.js';
import { statusRoutes } from './modules/status/status.routes.js';
import { userRoutes } from './modules/users/users.routes.js';

// Single source of truth for where each router is mounted. The docs test reads
// this to check that every real route is documented in the OpenAPI spec.
export const apiMounts = [
  { prefix: '/api/v1/auth', router: authRoutes, auth: false },
  { prefix: '/api/v1/users', router: userRoutes, auth: true },
  { prefix: '/api/v1/monitors', router: monitorRoutes, auth: true },
  { prefix: '/api/v1/status', router: statusRoutes, auth: false },
];

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' || req.url.startsWith('/docs') },
      // The default logs every header, including the Authorization token.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.get('/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down' });
  });

  // Swagger UI loads its scripts as same-origin files, so helmet's CSP works.
  // upgrade-insecure-requests is dropped: it breaks assets on plain-http dev.
  app.get('/docs/openapi.json', (_req, res) => res.json(openapiSpec));
  app.use(
    '/docs',
    helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }),
    swaggerUi.serve,
    swaggerUi.setup(openapiSpec, {
      customSiteTitle: 'Uptime Monitor API docs',
      swaggerOptions: { persistAuthorization: true, validatorUrl: null },
    }),
  );

  for (const { prefix, router, auth } of apiMounts) {
    app.use(prefix, ...(auth ? [requireAuth] : []), router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
