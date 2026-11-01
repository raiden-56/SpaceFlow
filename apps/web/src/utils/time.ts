import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isToday from 'dayjs/plugin/isToday';
import isTomorrow from 'dayjs/plugin/isTomorrow';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);
dayjs.extend(isToday);
dayjs.extend(isTomorrow);

export { dayjs };

export const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Combine a local date (YYYY-MM-DD) + time (HH:mm) in a timezone into an ISO instant. */
export function toIso(date: string, time: string, tz: string): string {
  return dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', tz).toISOString();
}

export function fmtTime(iso: string, tz?: string): string {
  return dayjs(iso).tz(tz ?? browserTz).format('HH:mm');
}

export function fmtDate(iso: string, tz?: string): string {
  const d = dayjs(iso).tz(tz ?? browserTz);
  if (d.isToday()) return 'Today';
  if (d.isTomorrow()) return 'Tomorrow';
  return d.format('ddd, D MMM');
}

export function fmtDateLong(iso: string, tz?: string): string {
  return dayjs(iso).tz(tz ?? browserTz).format('dddd, D MMMM YYYY');
}

export function fmtRange(startIso: string, endIso: string, tz?: string): string {
  return `${fmtDate(startIso, tz)} · ${fmtTime(startIso, tz)}–${fmtTime(endIso, tz)}`;
}

export function fmtRelative(iso: string): string {
  return dayjs(iso).fromNow();
}

export function durationLabel(startIso: string, endIso: string): string {
  const mins = dayjs(endIso).diff(dayjs(startIso), 'minute');
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

export function todayIn(tz: string): string {
  return dayjs().tz(tz).format('YYYY-MM-DD');
}

/** Round "now" up to the next slot boundary in HH:mm for a timezone. */
export function nextSlot(tz: string, slotMinutes = 30): string {
  const now = dayjs().tz(tz);
  const m = Math.ceil((now.minute() + 1) / slotMinutes) * slotMinutes;
  return now.minute(0).add(m, 'minute').format('HH:mm');
}

export function timeOptions(start = '07:00', end = '20:00', step = 30): string[] {
  const out: string[] = [];
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  for (let t = sh * 60 + sm; t <= eh * 60 + em; t += step) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return out;
}
