import { describe, expect, it } from 'vitest';
import { findBookableOverlaps } from '../../src/modules/admin/workplace.js';

const desk = (label: string, x: number, y: number, rotation = 0) => ({ kind: 'DESK', label, x, y, width: 1.6, depth: 0.8, rotation });
const room = (label: string, x: number, y: number, width: number, depth: number) => ({ kind: 'MEETING_ROOM', label, x, y, width, depth, rotation: 0 });

describe('findBookableOverlaps', () => {
  it('accepts desks and rooms that only touch at their edges', () => {
    expect(findBookableOverlaps([desk('A', 0, 0), desk('B', 1.6, 0), desk('C', 0, 0.8), room('R', 3.2, 0, 5, 4)])).toEqual([]);
  });

  it('reports overlapping meeting rooms (the Atlas/Lyra demo bug)', () => {
    const issues = findBookableOverlaps([room('Lyra', 33, 1, 7, 5.5), room('Atlas', 34, 1, 9, 7)]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/Lyra.*overlaps.*Atlas|Atlas.*overlaps.*Lyra/);
  });

  it('accounts for 90° rotation and ignores non-bookable objects', () => {
    // Rotated desk occupies 0.8 x 1.6 around its centre (1.2, 0.8) => x 0.8..1.6, y 0..1.6
    expect(findBookableOverlaps([desk('rot', 0.4, 0.4, 90), desk('right', 1.6, 0)])).toEqual([]);
    expect(findBookableOverlaps([desk('rot', 0.4, 0.4, 90), desk('below', 0, 1.2)])).toHaveLength(1);
    expect(findBookableOverlaps([{ kind: 'ZONE', label: 'z', x: 0, y: 0, width: 10, depth: 10 }, desk('A', 1, 1)])).toEqual([]);
  });
});
