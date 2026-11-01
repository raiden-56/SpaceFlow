import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(customParseFormat);

export { dayjs };

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Parse an ISO datetime string into a Date, throwing on invalid input. */
export function toDate(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid datetime: ${iso}`);
  return d;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a given timezone. */
export function localDate(at: Date, tz: string): string {
  return dayjs(at).tz(tz).format('YYYY-MM-DD');
}

/** Local HH:mm of an instant in a given timezone. */
export function localTime(at: Date, tz: string): string {
  return dayjs(at).tz(tz).format('HH:mm');
}

/** Local weekday 0..6 (Sunday..Saturday). */
export function localWeekday(at: Date, tz: string): number {
  return dayjs(at).tz(tz).day();
}

/** Build an instant from a local date + HH:mm in a timezone (DST-safe through dayjs.tz). */
export function fromLocal(date: string, time: string, tz: string): Date {
  return dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', tz).toDate();
}

/** Start of a local day as a UTC instant. */
export function startOfLocalDay(date: string, tz: string): Date {
  return dayjs.tz(date, 'YYYY-MM-DD', tz).startOf('day').toDate();
}

export function endOfLocalDay(date: string, tz: string): Date {
  return dayjs.tz(date, 'YYYY-MM-DD', tz).add(1, 'day').startOf('day').toDate();
}

export function startOfLocalWeek(at: Date, tz: string): Date {
  return dayjs(at).tz(tz).startOf('isoWeek').toDate();
}

export function addDays(date: string, days: number): string {
  return dayjs(date, 'YYYY-MM-DD').add(days, 'day').format('YYYY-MM-DD');
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Half-open interval overlap test: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅ */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function formatRange(start: Date, end: Date, tz: string): string {
  const s = dayjs(start).tz(tz);
  const e = dayjs(end).tz(tz);
  if (s.isSame(e, 'day')) return `${s.format('ddd D MMM, HH:mm')}–${e.format('HH:mm')}`;
  return `${s.format('ddd D MMM HH:mm')} – ${e.format('ddd D MMM HH:mm')}`;
}
