import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { buildOpenApiDocument } from '../../src/openapi/registry.js';

describe('OpenAPI document', () => {
  createApp(); // registers all route documentation
  const doc = buildOpenApiDocument('test');

  it('has the expected top-level shape and security scheme', () => {
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.title).toBe('SpaceFlow API');
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(Object.keys(doc.paths).length).toBeGreaterThan(80);
  });

  it('documents core endpoints with methods, params and bodies', () => {
    const paths = doc.paths as Record<string, Record<string, { parameters: { name: string; in: string }[]; requestBody?: unknown; security: unknown[] }>>;
    expect(paths['/api/v1/auth/login'].post.requestBody).toBeDefined();
    expect(paths['/api/v1/auth/login'].post.security).toEqual([]);
    expect(paths['/api/v1/reservations'].post.requestBody).toBeDefined();
    expect(paths['/api/v1/reservations/{id}/cancel'].post.parameters.some((p) => p.name === 'id' && p.in === 'path')).toBe(true);
    expect(paths['/api/v1/resources'].get.parameters.some((p) => p.name === 'floorId' && p.in === 'query')).toBe(true);
    expect(paths['/api/v1/auth/guest'].post).toBeDefined();
    expect(paths['/api/v1/admin/buildings'].post).toBeDefined();
  });
});
