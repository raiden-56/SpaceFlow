import { describe, expect, it } from 'vitest';
import type { ResourceDto } from '@spaceflow/shared';
import { nearestFreeResource } from '../FloorMapPicker';

const res = (id: string, state: 'AVAILABLE' | 'RESERVED' | 'DISABLED'): ResourceDto =>
  ({ id, type: 'SEAT', status: 'ACTIVE', isBookable: true, availability: { resourceId: id, state, reason: null, canBook: state === 'AVAILABLE' } }) as unknown as ResourceDto;
const obj = (resourceId: string, x: number, y: number) => ({ resourceId, x, y, width: 1.6, depth: 0.8 });

describe('nearestFreeResource', () => {
  const objects = [obj('mate', 10, 10), obj('near-busy', 11.8, 10), obj('near-free', 10, 12), obj('far-free', 30, 20), obj('disabled', 10, 9)];
  const resources = [res('mate', 'RESERVED'), res('near-busy', 'RESERVED'), res('near-free', 'AVAILABLE'), res('far-free', 'AVAILABLE'), res('disabled', 'DISABLED')];

  it('picks the closest bookable desk, skipping busy and disabled ones', () => {
    expect(nearestFreeResource(objects, resources, 'mate')?.id).toBe('near-free');
  });

  it('respects the filter highlight set', () => {
    expect(nearestFreeResource(objects, resources, 'mate', new Set(['far-free']))?.id).toBe('far-free');
  });

  it('returns null when nothing is free or the origin is unknown', () => {
    expect(nearestFreeResource(objects, resources, 'mate', new Set())).toBeNull();
    expect(nearestFreeResource(objects, resources, 'missing')).toBeNull();
  });
});
