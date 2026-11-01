// "Book near my team": teammates' seats for a window, honouring each colleague's privacy setting.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, EMPLOYEE, api, auth, freeSeat, futureWeekday, iso, login, prisma, resetAndSeed, type Session } from './helpers.js';

describe('teammates on the map', () => {
  let admin: Session;
  let sam: Session; // Engineering / Platform
  const date = futureWeekday(15);
  const startAt = iso(date, '09:00');
  const endAt = iso(date, '17:00');

  beforeAll(async () => {
    await resetAndSeed();
    admin = await login(ADMIN.email, ADMIN.password);
    sam = await login(EMPLOYEE.email);
  });

  const bookFor = async (email: string, exclude: string[]) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    const seat = await freeSeat(date, exclude);
    const res = await api().post('/api/v1/reservations').set(auth(admin)).send({ resourceId: seat.id, startAt, endAt, onBehalfOfUserId: u.id });
    expect(res.status).toBe(201);
    return { user: u, seat };
  };

  it('lists same-team colleagues with their seat, excludes other teams and respects privacy', async () => {
    const priya = await bookFor('priya.sharma@spaceflow.local', []); // Platform (Sam's team)
    const karan = await bookFor('karan.patel@spaceflow.local', [priya.seat.id]); // Sales

    const res = await api().get(`/api/v1/resources/teammates?floorId=${priya.seat.floorId}&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`).set(auth(sam));
    expect(res.status).toBe(200);
    const priyaRow = res.body.find((t: { userId: string }) => t.userId === priya.user.id);
    expect(priyaRow).toMatchObject({ displayName: 'Priya Sharma', initials: 'PS', resourceId: priya.seat.id, isMe: false });
    expect(res.body.some((t: { userId: string }) => t.userId === karan.user.id)).toBe(false);

    await prisma.userPreference.update({ where: { userId: priya.user.id }, data: { shareLocationWithTeam: false } });
    const hidden = await api().get(`/api/v1/resources/teammates?floorId=${priya.seat.floorId}&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`).set(auth(sam));
    expect(hidden.body.some((t: { userId: string }) => t.userId === priya.user.id)).toBe(false);
  });

  it('validates the window', async () => {
    expect((await api().get('/api/v1/resources/teammates').set(auth(sam))).status).toBe(400);
  });
});
