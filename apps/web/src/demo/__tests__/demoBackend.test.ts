// @vitest-environment node
// The demo backend needs no DOM; only localStorage, provided here as an in-memory stand-in.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthResponseDto, BatchReservationResultDto, BuildingDto, DashboardDto, Paginated, ReservationDto, ResourceDto } from '@spaceflow/shared';
import { dayjs } from '@/utils/time';
import { demoFetch } from '../server';

const BASE = 'http://localhost/api/v1';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) },
});

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await demoFetch(`${BASE}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}

/** Next weekday 10:00–12:00 in the building's timezone. */
function nextWeekdayWindow(tz: string) {
  let d = dayjs().tz(tz).add(1, 'day');
  while (d.day() === 0 || d.day() === 6) d = d.add(1, 'day');
  const date = d.format('YYYY-MM-DD');
  return { startAt: dayjs.tz(`${date} 10:00`, 'YYYY-MM-DD HH:mm', tz).toISOString(), endAt: dayjs.tz(`${date} 12:00`, 'YYYY-MM-DD HH:mm', tz).toISOString() };
}

describe('demo backend', () => {
  beforeEach(async () => {
    await call('POST', '/auth/logout');
  });

  it('offers guest mode and explains that there are no accounts', async () => {
    expect((await call<{ enabled: boolean }>('GET', '/auth/guest/status')).data.enabled).toBe(true);
    const login = await call<{ error: { code: string; message: string } }>('POST', '/auth/login', { email: 'a@b.c', password: 'x' });
    expect(login.status).toBe(401);
    expect(login.data.error.message).toMatch(/Continue as guest/);
  });

  it('requires a guest session for API calls', async () => {
    expect((await call('GET', '/dashboard')).status).toBe(401);
    expect((await call('POST', '/auth/refresh')).status).toBe(401);
  });

  it('signs a guest in with sample data and restores the session on refresh', async () => {
    const guest = await call<AuthResponseDto>('POST', '/auth/guest');
    expect(guest.status).toBe(200);
    expect(guest.data.user.isGuest).toBe(true);
    expect(guest.data.user.permissions).toContain('resource:manage');
    const refreshed = await call<AuthResponseDto>('POST', '/auth/refresh');
    expect(refreshed.data.user.id).toBe(guest.data.user.id);

    const buildings = await call<BuildingDto[]>('GET', '/buildings');
    expect(buildings.data.map((b) => b.code).sort()).toEqual(['HT', 'RC']);
    expect(buildings.data.find((b) => b.code === 'HT')!.seatCount).toBeGreaterThan(100);

    const dash = await call<DashboardDto>('GET', '/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.data.availability.totalSeats).toBeGreaterThan(0);
    expect(dash.data.favorites.length).toBeGreaterThan(0);
    expect(dash.data.unreadNotifications).toBeGreaterThan(0);
  });

  it('books a free seat, rejects a double booking with alternatives, and cancels', async () => {
    await call('POST', '/auth/guest');
    const ht = (await call<BuildingDto[]>('GET', '/buildings')).data.find((b) => b.code === 'HT')!;
    const win = nextWeekdayWindow(ht.timezone);
    const free = await call<Paginated<ResourceDto>>('GET', `/resources?type=SEAT&buildingId=${ht.id}&startAt=${encodeURIComponent(win.startAt)}&endAt=${encodeURIComponent(win.endAt)}&availableOnly=true&pageSize=5`);
    const seat = free.data.items[0];
    expect(seat.availability?.state).toBe('AVAILABLE');

    const booked = await call<BatchReservationResultDto>('POST', '/reservations', { resourceId: seat.id, ...win });
    expect(booked.status).toBe(201);
    expect(booked.data.created[0].status).toBe('CONFIRMED');
    const id = booked.data.created[0].id;

    const again = await call<{ error: { code: string; details: { alternatives: unknown[] } } }>('POST', '/reservations', { resourceId: seat.id, ...win });
    expect(again.status).toBe(409);
    expect(again.data.error.code).toBe('BOOKING_CONFLICT');
    expect(again.data.error.details.alternatives.length).toBeGreaterThan(0);

    const after = await call<ResourceDto>('GET', `/resources/${seat.id}?startAt=${encodeURIComponent(win.startAt)}&endAt=${encodeURIComponent(win.endAt)}`);
    expect(after.data.availability?.state).toBe('RESERVED');

    const cancelled = await call<ReservationDto>('POST', `/reservations/${id}/cancel`, { reason: 'Plans changed' });
    expect(cancelled.data.status).toBe('CANCELLED');
    const freed = await call<ResourceDto>('GET', `/resources/${seat.id}?startAt=${encodeURIComponent(win.startAt)}&endAt=${encodeURIComponent(win.endAt)}`);
    expect(freed.data.availability?.state).toBe('AVAILABLE');
  });

  it('returns a JSON 404 for endpoints the demo does not implement', async () => {
    await call('POST', '/auth/guest');
    const res = await call<{ error: { code: string } }>('GET', '/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe('NOT_FOUND');
  });
});
