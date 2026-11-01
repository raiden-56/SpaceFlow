import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { HealthDto } from '@spaceflow/shared';
import { checkDatabase } from '../../lib/prisma.js';
import { jobsStatus } from '../../jobs/scheduler.js';
import { buildOpenApiDocument, doc } from '../../openapi/registry.js';

export const systemRouter = Router();
export const APP_VERSION = process.env.npm_package_version ?? '0.1.0';
const startedAt = Date.now();

doc({ method: 'get', path: '/health', summary: 'Liveness + readiness', tags: ['System'], auth: false });
systemRouter.get('/health', async (_req, res) => {
  const db = await checkDatabase();
  const body: HealthDto = {
    status: db ? 'ok' : 'degraded',
    version: APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    checks: { database: db ? 'ok' : 'error', jobs: jobsStatus() },
  };
  res.status(db ? 200 : 503).json(body);
});

doc({ method: 'get', path: '/openapi.json', summary: 'OpenAPI 3.0 document', tags: ['System'], auth: false });
systemRouter.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApiDocument(APP_VERSION));
});

systemRouter.use('/docs', swaggerUi.serve, (req: Parameters<typeof swaggerUi.setup>[0] extends never ? never : any, res: any, next: any) =>
  swaggerUi.setup(buildOpenApiDocument(APP_VERSION), { customSiteTitle: 'SpaceFlow API docs' })(req, res, next),
);
