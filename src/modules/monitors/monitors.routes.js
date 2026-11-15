import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { serializeMonitor } from '../../utils/serializers.js';
import { objectId } from '../../utils/validation.js';
import {
  checksQuery,
  createMonitorSchema,
  incidentsQuery,
  responseTimesQuery,
  statsQuery,
  updateMonitorSchema,
} from './monitors.schemas.js';
import * as monitors from './monitors.service.js';
import { monitorStats, responseTimeSeries } from './stats.service.js';

const idParams = z.object({ id: objectId });

export const monitorRoutes = Router();

monitorRoutes.get('/', async (req, res) => {
  res.json({ data: await monitors.listMonitors(req.userId) });
});

monitorRoutes.post('/', validate({ body: createMonitorSchema }), async (req, res) => {
  res.status(201).json({ monitor: await monitors.createMonitor(req.userId, req.valid.body) });
});

monitorRoutes.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json({ monitor: serializeMonitor(await monitors.getOwnedMonitor(req.userId, req.valid.params.id)) });
});

monitorRoutes.patch('/:id', validate({ params: idParams, body: updateMonitorSchema }), async (req, res) => {
  res.json({ monitor: await monitors.updateMonitor(req.userId, req.valid.params.id, req.valid.body) });
});

monitorRoutes.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await monitors.deleteMonitor(req.userId, req.valid.params.id);
  res.status(204).end();
});

// Real check now: saved, updates status, may open/resolve an incident and alert.
monitorRoutes.post('/:id/check', validate({ params: idParams }), async (req, res) => {
  res.json(await monitors.checkNow(req.userId, req.valid.params.id));
});

// Probe right now without saving anything — handy right after creating a monitor.
monitorRoutes.post('/:id/test', validate({ params: idParams }), async (req, res) => {
  res.json(await monitors.testMonitor(req.userId, req.valid.params.id));
});

monitorRoutes.get('/:id/stats', validate({ params: idParams, query: statsQuery }), async (req, res) => {
  const monitor = await monitors.getOwnedMonitor(req.userId, req.valid.params.id);
  res.json(await monitorStats(monitor, req.valid.query.period));
});

monitorRoutes.get(
  '/:id/response-times',
  validate({ params: idParams, query: responseTimesQuery }),
  async (req, res) => {
    const monitor = await monitors.getOwnedMonitor(req.userId, req.valid.params.id);
    res.json(await responseTimeSeries(monitor, req.valid.query.period, req.valid.query.bucket));
  },
);

monitorRoutes.get('/:id/checks', validate({ params: idParams, query: checksQuery }), async (req, res) => {
  const monitor = await monitors.getOwnedMonitor(req.userId, req.valid.params.id);
  res.json(await monitors.listChecks(monitor, req.valid.query));
});

monitorRoutes.get('/:id/incidents', validate({ params: idParams, query: incidentsQuery }), async (req, res) => {
  const monitor = await monitors.getOwnedMonitor(req.userId, req.valid.params.id);
  res.json(await monitors.listIncidents(monitor, req.valid.query));
});
