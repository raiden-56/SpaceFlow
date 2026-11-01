import { describe, expect, it } from 'vitest';
import type { FloorDto, MapObjectDto, ResourceDto } from '@spaceflow/shared';
import { buildDeskInstances, fitTransform, floorPose, layoutFloors, objectCenter, overviewPose, resourceState, stateColor, zoomAbout, FLOOR_HEIGHT, EXPLODE_GAP, DESK_HEIGHT } from '../geometry';

const floor = (id: string, number: number, sortOrder: number, w: number | null = 40, d: number | null = 24): FloorDto => ({
  id, buildingId: 'b', name: `Floor ${number}`, number, sortOrder, isPublished: true, hasFloorPlan: true, floorPlanStatus: 'PUBLISHED', seatCount: 10, roomCount: 2, widthM: w, depthM: d, createdAt: '', updatedAt: '',
});

describe('layoutFloors', () => {
  it('stacks floors bottom-up by sortOrder and applies the exploded gap', () => {
    const floors = [floor('b', 1, 1), floor('a', 0, 0), floor('c', 2, 2, null, null)];
    const stacked = layoutFloors(floors);
    expect(stacked.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(stacked[1].y).toBeCloseTo(FLOOR_HEIGHT);
    expect(stacked[2].widthM).toBe(40); // fallback when the plan has no dimensions
    const exploded = layoutFloors(floors, true);
    expect(exploded[2].y).toBeCloseTo(2 * (FLOOR_HEIGHT + EXPLODE_GAP));
  });
});

describe('camera poses', () => {
  it('frames the whole building from above and in front', () => {
    const pose = overviewPose(layoutFloors([floor('a', 0, 0), floor('b', 1, 1)]));
    expect(pose.target[0]).toBe(20);
    expect(pose.position[1]).toBeGreaterThan(2 * FLOOR_HEIGHT);
    expect(pose.position[2]).toBeGreaterThan(24);
  });
  it('targets the selected floor slab', () => {
    const [, f1] = layoutFloors([floor('a', 0, 0), floor('b', 1, 1)]);
    const pose = floorPose(f1);
    expect(pose.target).toEqual([20, FLOOR_HEIGHT, 12]);
    expect(pose.position[1]).toBeGreaterThan(FLOOR_HEIGHT);
  });
});

describe('desk instances', () => {
  const obj = (id: string, resourceId: string | null, rotation = 0): MapObjectDto => ({ id, kind: 'DESK', label: id, x: 2, y: 4, width: 1.6, depth: 0.8, rotation, height: null, resourceId, meta: null });
  const res = (id: string, state: 'AVAILABLE' | 'RESERVED'): ResourceDto => ({ id, type: 'SEAT', code: id, name: id, description: null, status: 'ACTIVE', isBookable: true, requiresApproval: false, buildingId: 'b', buildingName: 'B', buildingTimezone: 'UTC', floorId: 'f', floorName: 'F', floorNumber: 1, zoneId: null, zoneName: null, capacity: null, seatType: 'WORKSTATION', roomType: null, seatAttributes: null, accessible: false, amenities: [], operatingHours: null, maxDurationMinutes: null, checkInRequired: null, restrictedDepartmentIds: [], restrictedTeamIds: [], mapPosition: null, availability: { resourceId: id, state, reason: null, canBook: state === 'AVAILABLE' }, createdAt: '', updatedAt: '' });

  it('centres desks on the slab and colours them by availability / selection', () => {
    const resources = new Map([['r1', res('r1', 'AVAILABLE')], ['r2', res('r2', 'RESERVED')]]);
    const out = buildDeskInstances([obj('d1', 'r1', 180), obj('d2', 'r2'), obj('d3', null)], resources, FLOOR_HEIGHT, 'r2');
    expect(out[0].position).toEqual(objectCenter(obj('d1', 'r1'), FLOOR_HEIGHT, DESK_HEIGHT));
    expect(out[0].rotationY).toBeCloseTo(-Math.PI);
    expect(out[0].color).toBe(stateColor('AVAILABLE'));
    expect(out[1].color).toBe(stateColor('SELECTED'));
    expect(out[2].color).toBe(stateColor('DISABLED'));
  });
  it('falls back to resource status when no availability window is loaded', () => {
    const r = { ...res('r', 'AVAILABLE'), availability: undefined };
    expect(resourceState(r)).toBe('AVAILABLE');
    expect(resourceState({ ...r, status: 'MAINTENANCE' })).toBe('DISABLED');
  });
});

describe('2D transforms', () => {
  it('fits the plan into the viewport with padding', () => {
    const t = fitTransform(40, 24, 800, 400, 20);
    expect(t.scale).toBeCloseTo(15);
    expect(t.tx).toBeCloseTo(100);
    expect(t.ty).toBeCloseTo(20);
  });
  it('zooms about the cursor position', () => {
    const t = { scale: 10, tx: 0, ty: 0 };
    const z = zoomAbout(t, 2, 100, 50);
    expect(z.scale).toBe(20);
    // the plan point under (100,50) stays under the cursor
    expect((100 - z.tx) / z.scale).toBeCloseTo((100 - t.tx) / t.scale);
    expect((50 - z.ty) / z.scale).toBeCloseTo((50 - t.ty) / t.scale);
  });
});
