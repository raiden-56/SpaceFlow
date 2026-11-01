import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isExclusionViolation } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { captureException } from '../lib/monitoring.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, requestId: req.requestId },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId;

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, requestId }, err.message);
    else logger.debug({ code: err.code, requestId }, err.message);
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, requestId },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
        requestId,
      },
    });
  }

  // Body parser errors (malformed JSON, payload too large)
  const anyErr = err as { type?: string; status?: number; code?: string; message?: string };
  if (anyErr?.type === 'entity.parse.failed') {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body', requestId } });
  }
  if (anyErr?.type === 'entity.too.large' || anyErr?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: { code: 'FILE_TOO_LARGE', message: `Upload exceeds the ${env.MAX_UPLOAD_MB} MB limit`, requestId },
    });
  }

  if (isExclusionViolation(err)) {
    return res.status(409).json({
      error: {
        code: 'BOOKING_CONFLICT',
        message: 'This resource was just booked by someone else for an overlapping time.',
        requestId,
      },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'A record with the same unique value already exists',
          details: { fields: err.meta?.target },
          requestId,
        },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found', requestId } });
    }
    if (err.code === 'P2003') {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'Referenced record does not exist', requestId },
      });
    }
  }

  logger.error({ err, requestId, path: req.path, method: req.method }, 'unhandled error');
  captureException(err, { requestId, path: req.path });
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
      requestId,
    },
  });
}
