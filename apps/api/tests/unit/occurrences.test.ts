import { describe, expect, it } from 'vitest';
import { expandOccurrences } from '../../src/modules/reservations/service.js';
import { localDate, localTime } from '../../src/utils/time.js';

const TZ = 'Asia/Kolkata';
const start = new Date('2026-11-02T03:30:00Z'); // Mon 2 Nov 09:00 IST
const end = new Date('2026-11-02T11:30:00Z'); // 17:00 IST

describe('expandOccurrences', () => {
  it('returns a single occurrence without recurrence', () => {
    const occ = expandOccurrences(start, end, TZ, undefined, undefined, 12);
    expect(occ).toHaveLength(1);
    expect(occ[0].startAt.toISOString()).toBe(start.toISOString());
  });

  it('expands daily recurrence by count', () => {
    const occ = expandOccurrences(start, end, TZ, { frequency: 'DAILY', interval: 1, count: 3 }, undefined, 12);
    expect(occ.map((o) => localDate(o.startAt, TZ))).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(occ.every((o) => localTime(o.startAt, TZ) === '09:00' && localTime(o.endAt, TZ) === '17:00')).toBe(true);
  });

  it('expands weekly recurrence on the base weekday with interval', () => {
    const occ = expandOccurrences(start, end, TZ, { frequency: 'WEEKLY', interval: 2, count: 3 }, undefined, 12);
    expect(occ.map((o) => localDate(o.startAt, TZ))).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });

  it('expands weekly recurrence by weekday list and stops at until', () => {
    const occ = expandOccurrences(start, end, TZ, { frequency: 'WEEKLY', interval: 1, byWeekday: [1, 3], until: '2026-11-11' }, undefined, 12);
    expect(occ.map((o) => localDate(o.startAt, TZ))).toEqual(['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11']);
  });

  it('caps at maxOccurrences when count is omitted', () => {
    const occ = expandOccurrences(start, end, TZ, { frequency: 'DAILY', interval: 1 }, undefined, 4);
    expect(occ).toHaveLength(4);
  });

  it('merges additional dates (sorted, de-duplicated)', () => {
    const occ = expandOccurrences(start, end, TZ, undefined, ['2026-11-05', '2026-11-02', '2026-11-03'], 12);
    expect(occ.map((o) => localDate(o.startAt, TZ))).toEqual(['2026-11-02', '2026-11-03', '2026-11-05']);
  });

  it('keeps wall-clock times across a DST change', () => {
    const tz = 'Europe/Zurich';
    const s = new Date('2026-03-27T08:00:00Z'); // Fri 09:00 CET
    const e = new Date('2026-03-27T16:00:00Z'); // 17:00 CET
    const occ = expandOccurrences(s, e, tz, { frequency: 'DAILY', interval: 1, count: 4 }, undefined, 12);
    const mon = occ[3]; // Mon 30 March, CEST
    expect(localDate(mon.startAt, tz)).toBe('2026-03-30');
    expect(localTime(mon.startAt, tz)).toBe('09:00');
    expect(localTime(mon.endAt, tz)).toBe('17:00');
    expect(mon.startAt.toISOString()).toBe('2026-03-30T07:00:00.000Z');
  });
});
