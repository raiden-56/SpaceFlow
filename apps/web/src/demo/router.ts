import type { Ctx, Reply } from './core';

export type Handler = (ctx: Ctx) => unknown | Reply | Promise<unknown | Reply>;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path below /api/v1 with :params, e.g. /reservations/:id/cancel */
  path: string;
  handler: Handler;
  /** No session required (sign-in endpoints). ctx.user and ctx.db may be unset. */
  public?: boolean;
}

export const get = (path: string, handler: Handler, opts: { public?: boolean } = {}): Route => ({ method: 'GET', path, handler, ...opts });
export const post = (path: string, handler: Handler, opts: { public?: boolean } = {}): Route => ({ method: 'POST', path, handler, ...opts });
export const put = (path: string, handler: Handler): Route => ({ method: 'PUT', path, handler });
export const patch = (path: string, handler: Handler): Route => ({ method: 'PATCH', path, handler });
export const del = (path: string, handler: Handler): Route => ({ method: 'DELETE', path, handler });
