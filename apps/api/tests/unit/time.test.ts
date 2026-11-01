import { describe, expect, it } from 'vitest';
import {
  addDays,
  endOfLocalDay,
  fromLocal,
  isValidTimezone,
  localDate,
  localTime,
  localWeekday,
  minutesBetween,
  overlaps,
  startOfLocalDay,
  startOfLocalWeek,
  timeToMinutes,
} from '../../src/utils/time.js';

describe('time utils', () => {
  it('converts instants to local dates/times in the building timezone', () => {
    const at = new Date('2026-03-01T22:30:00Z');
    expect(localDate(at, 'Asia/Kolkata')).toBe('2026-03-02'); // 04:00 IST next day
    expect(localTime(at, 'Asia/Kolkata')).toBe('04:00');
    expect(localDate(at, 'America/Los_Angeles')).toBe('2026-03-01');
    expect(localWeekday(at, 'Asia/Kolkata')).toBe(1); // Monday
  });

  it('builds instants from local date + time across the Zurich DST transition', () => {
    // 29 March 2026: clocks move 02:00 -> 03:00 in Europe/Zurich (UTC+1 -> UTC+2)
    const before = fromLocal('2026-03-28', '09:00', 'Europe/Zurich');
    const after = fromLocal('2026-03-30', '09:00', 'Europe/Zurich');
    expect(before.toISOString()).toBe('2026-03-28T08:00:00.000Z');
    expect(after.toISOString()).toBe('2026-03-30T07:00:00.000Z');
    // The local day on the transition date is 23 hours long.
    const dayLen = endOfLocalDay('2026-03-29', 'Europe/Zurich').getTime() - startOfLocalDay('2026-03-29', 'Europe/Zurich').getTime();
    expect(dayLen).toBe(23 * 3600000);
  });

  it('half-open overlap: touching intervals do not overlap', () => {
    const a = new Date('2026-01-01T09:00:00Z');
    const b = new Date('2026-01-01T10:00:00Z');
    const c = new Date('2026-01-01T11:00:00Z');
    expect(overlaps(a, b, b, c)).toBe(false);
    expect(overlaps(a, c, b, c)).toBe(true);
    expect(overlaps(b, c, a, b)).toBe(false);
  });

  it('start of local ISO week is Monday 00:00 local', () => {
    const wed = new Date('2026-11-04T12:00:00Z');
    const start = startOfLocalWeek(wed, 'Asia/Kolkata');
    expect(localDate(start, 'Asia/Kolkata')).toBe('2026-11-02');
    expect(localTime(start, 'Asia/Kolkata')).toBe('00:00');
  });

  it('misc helpers', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(timeToMinutes('09:30')).toBe(570);
    expect(minutesBetween(new Date('2026-01-01T09:00:00Z'), new Date('2026-01-01T10:15:00Z'))).toBe(75);
    expect(isValidTimezone('Europe/Zurich')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});
