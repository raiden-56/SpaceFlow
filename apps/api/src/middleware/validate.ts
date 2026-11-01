import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../lib/errors.js';

type Target = 'body' | 'query' | 'params';

function formatIssues(issues: { path: PropertyKey[]; message: string }[]) {
  return issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

export function validate<T>(schema: ZodType<T>, target: Target = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const input = target === 'body' ? req.body : target === 'query' ? req.query : req.params;
    const result = schema.safeParse(input ?? {});
    if (!result.success) {
      return next(
        AppError.badRequest('Request validation failed', {
          target,
          issues: formatIssues(result.error.issues),
        }),
      );
    }
    req.validated = req.validated ?? {};
    req.validated[target] = result.data;
    next();
  };
}

export function body<T>(req: Request): T {
  return req.validated?.body as T;
}
export function query<T>(req: Request): T {
  return req.validated?.query as T;
}
export function params<T>(req: Request): T {
  return req.validated?.params as T;
}
