import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { API_PREFIX } from '@spaceflow/shared';
import { env } from './config/env.js';
import { AppError } from './lib/errors.js';
import { requestContext, httpLogger } from './middleware/requestContext.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { systemRouter } from './modules/system/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { buildingsRouter, floorsRouter } from './modules/buildings/routes.js';
import { amenitiesRouter, resourcesRouter, roomsRouter, seatsRouter } from './modules/resources/routes.js';
import { reservationsRouter } from './modules/reservations/routes.js';
import { searchRouter } from './modules/search/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { realtimeRouter } from './modules/realtime/routes.js';
import { assetsRouter } from './modules/assets/routes.js';
import { adminWorkplaceRouter } from './modules/admin/workplace.js';
import { adminPeopleRouter } from './modules/admin/people.js';
import { adminGovernanceRouter } from './modules/admin/governance.js';

/**
 * Production: only the configured WEB_ORIGIN list.
 * Development/test: also any localhost / 127.0.0.1 port, because Vite moves to 5174, 5175…
 * when 5173 is already taken.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (env.webOrigins.includes(origin)) return true;
  if (env.isProd) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(
    helmet({
      contentSecurityPolicy: env.isProd ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || isAllowedOrigin(origin)) return cb(null, true);
        cb(new AppError(403, 'FORBIDDEN', `Origin ${origin} is not allowed. Add it to WEB_ORIGIN in the API .env.`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  if (!env.isTest) app.use(httpLogger);
  app.use(apiLimiter);

  app.get('/health', (_req, res) => res.redirect(307, `${API_PREFIX}/health`));
  app.use(API_PREFIX, systemRouter);
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/users`, usersRouter);
  app.use(`${API_PREFIX}/buildings`, buildingsRouter);
  app.use(`${API_PREFIX}/floors`, floorsRouter);
  app.use(`${API_PREFIX}/resources`, resourcesRouter);
  app.use(`${API_PREFIX}/seats`, seatsRouter);
  app.use(`${API_PREFIX}/meeting-rooms`, roomsRouter);
  app.use(`${API_PREFIX}/amenities`, amenitiesRouter);
  app.use(`${API_PREFIX}/reservations`, reservationsRouter);
  app.use(`${API_PREFIX}/search`, searchRouter);
  app.use(`${API_PREFIX}/dashboard`, dashboardRouter);
  app.use(`${API_PREFIX}/events`, realtimeRouter);
  app.use(`${API_PREFIX}/assets`, assetsRouter);
  app.use(`${API_PREFIX}/admin`, adminWorkplaceRouter);
  app.use(`${API_PREFIX}/admin`, adminPeopleRouter);
  app.use(`${API_PREFIX}/admin`, adminGovernanceRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
