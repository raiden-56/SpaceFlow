import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger.js';

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as Request).requestId,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/api/v1/health' },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
