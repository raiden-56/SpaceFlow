import { describe, expect, it } from 'vitest';
import { autoPlace, clampToFloor, rectsOverlap, snap, validateDraft, zoomViewBox, type StudioObject, type StudioResource } from '../mapStudio/studioUtils';

const obj = (o: Partial<StudioObject>): StudioObject => ({ key: Math.random().toString(36), kind: 'DESK', label: 'D', x: 0, y: 0, width: 1.6, depth: 0.8, rotation: 0, height: null, resourceId: null, meta: null, ...o });

describe('Map Studio helpers', () => {
  it('snaps to the grid and clamps objects inside the floor', () => {
    expect(snap(1.26, 0.5)).toBe(1.5);
    expect(snap(1.234, 0)).toBe(1.23);
    const c = clampToFloor({ x: 19.5, y: -2, width: 1.6, depth: 0.8 }, 20, 10);
    expect(c.x).toBe(18.4);
    expect(c.y).toBe(0);
    expect(clampToFloor({ x: 0, y: 0, width: 50, depth: 1 }, 20, 10).width).toBe(20);
  });

  it('validates bounds, duplicate links and type mismatches like the API', () => {
    const resources: StudioResource[] = [
      { id: 's1', code: 'A-1', name: 'Desk A-1', type: 'SEAT' },
      { id: 'r1', code: 'R-1', name: 'Room', type: 'MEETING_ROOM' },
    ];
    const issues = validateDraft(
      [obj({ resourceId: 's1' }), obj({ x: 5, resourceId: 's1' }), obj({ kind: 'MEETING_ROOM', x: 18, width: 5, resourceId: 'r1' }), obj({ resourceId: 'r1', x: 2, y: 2 }), obj({ label: null, x: 7 })],
      20,
      10,
      resources,
    );
    expect(issues.some((i) => /linked twice/.test(i))).toBe(true);
    expect(issues.some((i) => /outside the floor bounds/.test(i))).toBe(true);
    expect(issues.some((i) => /is a desk but R-1 is a meeting room/.test(i))).toBe(true);
    expect(issues.some((i) => /needs a label/.test(i))).toBe(true);
    expect(validateDraft([obj({ resourceId: 's1' })], 20, 10, resources)).toEqual([]);
  });

  it('auto-places unlinked desks without overlapping existing objects and reports what does not fit', () => {
    let n = 0;
    const existing = [obj({ kind: 'ELEVATOR', x: 0, y: 0, width: 3, depth: 3 })];
    const seats: StudioResource[] = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, code: `D-${i}`, name: `Desk ${i}`, type: 'SEAT' }));
    const { placed, unplaced } = autoPlace(seats, existing, 8, 4, () => `k${n++}`);
    expect(placed.length + unplaced.length).toBe(6);
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) {
      expect(p.x + p.width).toBeLessThanOrEqual(8);
      expect(p.y + p.depth).toBeLessThanOrEqual(4);
      expect(rectsOverlap(p, existing[0])).toBe(false);
      for (const q of placed) if (q !== p) expect(rectsOverlap(p, q)).toBe(false);
    }
    // A tiny floor cannot fit a meeting room at all.
    const tiny = autoPlace([{ id: 'r', code: 'R', name: 'R', type: 'MEETING_ROOM' }], [], 3, 3, () => 'x');
    expect(tiny.unplaced).toHaveLength(1);
  });

  it('zooms the viewBox around the cursor point', () => {
    const vb = zoomViewBox({ x: 0, y: 0, w: 40, h: 20 }, 0.5, 10, 10);
    expect(vb.w).toBe(20);
    expect(vb.h).toBe(10);
    // The anchor point stays at the same relative position.
    expect((10 - vb.x) / vb.w).toBeCloseTo(10 / 40);
  });
});
