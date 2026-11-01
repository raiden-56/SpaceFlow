// Demo backend entry point: a fetch()-compatible function that routes /api/v1 requests to the
// in-browser handlers instead of the network. Loaded lazily, only in demo builds.
import { API_PREFIX } from '@spaceflow/shared';
import { DemoError, Reply, findUser, getDb, hasSession, save, toAuthUser, type Ctx } from './core';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { workplaceRoutes } from './routes/workplace';
import { reservationRoutes } from './routes/reservations';
import { adminRoutes } from './routes/admin';
import type { Route } from './router';

interface CompiledRoute extends Route {
  regex: RegExp;
  keys: string[];
}

function compile(r: Route): CompiledRoute {
  const keys: string[] = [];
  const pattern = r.path.replace(/:([A-Za-z]+)/g, (_m, k: string) => {
    keys.push(k);
    return '([^/]+)';
  });
  return { ...r, regex: new RegExp(`^${pattern}/?$`), keys };
}

// Order matters: literal segments (/resources/availability) are registered before /:id routes.
const table: CompiledRoute[] = [...authRoutes, ...userRoutes, ...workplaceRoutes, ...reservationRoutes, ...adminRoutes].map(compile);

function json(status: number, body: unknown): Response {
  if (status === 204 || body === undefined) return new Response(null, { status: status === 200 ? 204 : status });
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function readBody(req: Request): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const type = req.headers.get('Content-Type') ?? '';
  if (type.includes('multipart/form-data')) return req.formData();
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw DemoError.badRequest('Malformed JSON body');
  }
}

const delay = (msec: number) => new Promise((r) => setTimeout(r, msec));

export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const idx = url.pathname.indexOf(API_PREFIX);
  const path = idx >= 0 ? url.pathname.slice(idx + API_PREFIX.length) : url.pathname;
  const method = req.method.toUpperCase();
  // A short pause keeps loading states and optimistic UI behaving as they do against the API.
  await delay(60 + Math.random() * 90);
  try {
    for (const r of table) {
      if (r.method !== method) continue;
      const m = r.regex.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const query = Object.fromEntries(url.searchParams.entries());
      const body = await readBody(req);
      const db = getDb();
      let ctx: Ctx;
      if (r.public) {
        ctx = { db: db as Ctx['db'], user: undefined as unknown as Ctx['user'], params, query, body };
      } else {
        const me = db && hasSession() ? findUser(db, db.guestUserId) : undefined;
        if (!db || !me) throw DemoError.unauthenticated('Your demo session has ended. Continue as guest to start a new one.');
        ctx = { db, user: toAuthUser(db, me), params, query, body };
      }
      const out = await r.handler(ctx);
      if (method !== 'GET') save();
      if (out instanceof Reply) {
        if (out.contentType === 'application/json') return json(out.status, out.body);
        return new Response(out.body as BodyInit, { status: out.status, headers: { 'Content-Type': out.contentType } });
      }
      return json(200, out);
    }
    throw new DemoError(404, 'NOT_FOUND', `${method} ${path} is not available in the demo.`);
  } catch (err) {
    if (err instanceof DemoError) return json(err.status, { error: { code: err.code, message: err.message, details: err.details } });
    if (err && typeof err === 'object' && 'issues' in err) {
      return json(400, { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: (err as { issues: unknown }).issues } });
    }
    console.error('[demo] handler failed', err);
    return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  }
}
