import { describe, expect, it } from 'vitest';
import {
  amenityUpdateSchema,
  buildingCreateSchema,
  buildingUpdateSchema,
  floorPlanUpsertSchema,
  floorUpdateSchema,
  loginSchema,
  policySchema,
  policyUpdateSchema,
  reservationCreateSchema,
  resourceListQuerySchema,
  roomUpdateSchema,
  seatCsvRowSchema,
  seatUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  zoneUpdateSchema,
} from '@spaceflow/shared';

describe('shared validation schemas', () => {
  it('reservationCreateSchema rejects end before start and applies defaults', () => {
    const bad = reservationCreateSchema.safeParse({ resourceId: '3f4e8b1a-2c4d-4e6f-8a9b-0c1d2e3f4a5b', startAt: '2026-11-02T10:00:00Z', endAt: '2026-11-02T09:00:00Z' });
    expect(bad.success).toBe(false);
    expect(bad.success ? '' : bad.error.issues[0].path.join('.')).toBe('endAt');
    const ok = reservationCreateSchema.safeParse({ resourceId: '3f4e8b1a-2c4d-4e6f-8a9b-0c1d2e3f4a5b', startAt: '2026-11-02T09:00:00Z', endAt: '2026-11-02T10:00:00Z' });
    expect(ok.success && ok.data.atomic).toBe(true);
  });

  it('resourceListQuerySchema coerces query strings', () => {
    const q = resourceListQuerySchema.parse({ page: '2', pageSize: '10', nearWindow: 'true', monitor: '0', amenityIds: 'a,b , c', minCapacity: '4' });
    expect(q.page).toBe(2);
    expect(q.pageSize).toBe(10);
    expect(q.nearWindow).toBe(true);
    expect(q.monitor).toBe(false);
    expect(q.amenityIds).toEqual(['a', 'b', 'c']);
    expect(q.minCapacity).toBe(4);
    expect(resourceListQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false);
  });

  it('policySchema fills defaults and validates times', () => {
    const p = policySchema.parse({ name: 'Default' });
    expect(p.advanceBookingDays).toBe(30);
    expect(p.operatingStart).toBe('07:00');
    expect(p.checkInRequired).toBe(true);
    expect(policySchema.safeParse({ name: 'x', operatingStart: '25:00' }).success).toBe(false);
  });

  it('loginSchema requires a valid email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  it('floorPlanUpsertSchema validates objects', () => {
    expect(floorPlanUpsertSchema.safeParse({ widthM: 10, depthM: 10, objects: [{ kind: 'DESK', x: 1, y: 1, width: 1.6, depth: 0.8 }] }).success).toBe(true);
    expect(floorPlanUpsertSchema.safeParse({ widthM: 10, depthM: 10, objects: [{ kind: 'SOFA', x: 1, y: 1, width: 1, depth: 1 }] }).success).toBe(false);
    expect(floorPlanUpsertSchema.safeParse({ widthM: 0, depthM: 10, objects: [] }).success).toBe(false);
  });

  it('seatCsvRowSchema coerces booleans and numbers', () => {
    const row = seatCsvRowSchema.parse({ code: 'A-1', name: 'Desk', floorNumber: '1', nearWindow: 'yes', monitor: 'false', x: '2.5' });
    expect(row.floorNumber).toBe(1);
    expect(row.nearWindow).toBe(true);
    expect(row.monitor).toBe(false);
    expect(row.x).toBe(2.5);
  });

  it('update schemas only return fields that were sent (no defaults)', () => {
    const updateSchemas = { buildingUpdateSchema, floorUpdateSchema, zoneUpdateSchema, seatUpdateSchema, roomUpdateSchema, amenityUpdateSchema, policyUpdateSchema, userUpdateSchema };
    for (const [name, schema] of Object.entries(updateSchemas)) {
      expect(schema.parse({}), name).toEqual({});
    }
    expect(buildingUpdateSchema.parse({ name: 'HQ' })).toEqual({ name: 'HQ' });
    expect(userUpdateSchema.parse({ jobTitle: 'Lead' })).toEqual({ jobTitle: 'Lead' });
    expect(policyUpdateSchema.parse({ allowWeekends: true })).toEqual({ allowWeekends: true });
  });

  it('update schemas still validate fields that were sent', () => {
    expect(buildingUpdateSchema.safeParse({ isActive: 'yes' }).success).toBe(false);
    expect(userUpdateSchema.safeParse({ roles: [] }).success).toBe(false);
    expect(policyUpdateSchema.safeParse({ operatingStart: '25:00' }).success).toBe(false);
    expect(floorUpdateSchema.parse({ isPublished: false, sortOrder: 2 })).toEqual({ isPublished: false, sortOrder: 2 });
  });

  it('create schemas keep their defaults', () => {
    expect(buildingCreateSchema.parse({ name: 'HQ', code: 'HQ', timezone: 'UTC' }).isActive).toBe(true);
    expect(userCreateSchema.parse({ email: 'a@b.co', firstName: 'A', lastName: 'B' }).roles).toEqual(['EMPLOYEE']);
  });
});
