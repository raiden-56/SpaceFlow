// Lightweight OpenAPI registry. Each router registers its operations here so the generated
// document stays in sync with the code. Zod schemas are converted with zod's native JSON schema
// output (zod v4) for request bodies and query parameters.
import { z, type ZodType } from 'zod';
import { API_PREFIX } from '@spaceflow/shared';

export interface OperationDoc {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string; // relative to /api/v1, express-style (:id)
  summary: string;
  tags: string[];
  auth?: boolean;
  permissions?: string[];
  body?: ZodType;
  query?: ZodType;
  params?: Record<string, string>;
  responses?: Record<number, string>;
}

const operations: OperationDoc[] = [];

export function doc(op: OperationDoc) {
  operations.push(op);
}

function toJsonSchema(schema: ZodType): Record<string, unknown> {
  try {
    const out = z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any' }) as Record<string, unknown>;
    delete out.$schema;
    return out;
  } catch {
    return { type: 'object' };
  }
}

function expressToOpenApiPath(p: string): string {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function buildOpenApiDocument(version: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of operations) {
    const fullPath = `${API_PREFIX}${expressToOpenApiPath(op.path)}`;
    paths[fullPath] = paths[fullPath] ?? {};
    const pathParams = [...op.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
      description: op.params?.[m[1]],
    }));
    const queryParams: unknown[] = [];
    if (op.query) {
      const qs = toJsonSchema(op.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(qs.properties ?? {})) {
        queryParams.push({ name, in: 'query', required: qs.required?.includes(name) ?? false, schema });
      }
    }
    const responses: Record<string, unknown> = {};
    for (const [code, description] of Object.entries(op.responses ?? { 200: 'Success' })) {
      responses[code] = { description };
    }
    if (op.auth !== false) {
      responses['401'] = { description: 'Authentication required' };
      if (op.permissions?.length) responses['403'] = { description: 'Insufficient permissions' };
    }
    responses['400'] = responses['400'] ?? { description: 'Validation error' };
    paths[fullPath][op.method] = {
      summary: op.summary,
      tags: op.tags,
      description: op.permissions?.length ? `Requires: ${op.permissions.join(', ')}` : undefined,
      security: op.auth === false ? [] : [{ bearerAuth: [] }],
      parameters: [...pathParams, ...queryParams],
      requestBody: op.body
        ? { required: true, content: { 'application/json': { schema: toJsonSchema(op.body) } } }
        : undefined,
      responses,
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'SpaceFlow API',
      version,
      description:
        'Smart office booking and 3D workplace management API. All responses are JSON. Errors use the shape `{ error: { code, message, details?, requestId } }`.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    tags: [
      { name: 'Auth' },
      { name: 'Users' },
      { name: 'Buildings' },
      { name: 'Floors' },
      { name: 'Resources' },
      { name: 'Seats' },
      { name: 'Meeting Rooms' },
      { name: 'Reservations' },
      { name: 'Search' },
      { name: 'Notifications' },
      { name: 'Dashboard' },
      { name: 'Admin' },
      { name: 'Analytics' },
      { name: 'Assets' },
      { name: 'Realtime' },
      { name: 'System' },
    ],
    paths,
  };
}
