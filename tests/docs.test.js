import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiMounts, createApp } from '../src/app.js';

const app = createApp();

// Express "/:id/stats" → OpenAPI "/{id}/stats"
const toOpenApiPath = (path) => path.replace(/:(\w+)/g, '{$1}');

/** Every [method, path] actually registered on the app, read from the routers themselves. */
function registeredRoutes() {
  const routes = [];
  const collect = (stack, prefix) => {
    for (const layer of stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        const path = prefix + (layer.route.path === '/' ? '' : layer.route.path);
        routes.push([method, toOpenApiPath(path || '/')]);
      }
    }
  };
  collect(app.router.stack, '');
  for (const { prefix, router } of apiMounts) collect(router.stack, prefix);
  return routes.filter(([, path]) => !path.startsWith('/docs'));
}

describe('API docs', () => {
  it('serves an OpenAPI 3.1 spec', async () => {
    const res = await request(app).get('/docs/openapi.json').expect(200);
    expect(res.body.openapi).toMatch(/^3\.1\./);
    expect(res.body.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('documents every registered route, and nothing that does not exist', async () => {
    const { body: spec } = await request(app).get('/docs/openapi.json');
    const routes = registeredRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(18);

    const missing = routes.filter(([method, path]) => !spec.paths[path]?.[method]).map((r) => r.join(' '));
    expect(missing).toEqual([]);

    const real = new Set(routes.map((r) => r.join(' ')));
    const documented = Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.keys(ops)
        .filter((k) => k !== 'parameters')
        .map((method) => `${method} ${path}`),
    );
    expect(documented.filter((d) => !real.has(d))).toEqual([]);
  });

  it('generates request schemas from the real Zod validators', async () => {
    const { body: spec } = await request(app).get('/docs/openapi.json');
    const create = spec.paths['/api/v1/monitors'].post.requestBody.content['application/json'].schema;
    expect(create.required).toEqual(expect.arrayContaining(['name', 'url']));
    expect(create.properties.intervalMinutes).toMatchObject({ minimum: 1, maximum: 1440, default: 5 });
  });

  it('serves the Swagger UI and its assets', async () => {
    const html = await request(app).get('/docs/').expect(200);
    expect(html.text).toContain('swagger-ui');
    await request(app).get('/docs/swagger-ui-init.js').expect(200);
    await request(app).get('/docs/swagger-ui-bundle.js').expect(200);
  });
});
