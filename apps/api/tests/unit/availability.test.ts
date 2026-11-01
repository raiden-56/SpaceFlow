import { describe, expect, it } from 'vitest';
import { checkOperatingHours, operatingWindowFor, userCanAccessResource } from '../../src/modules/availability/service.js';

const policy = { operatingStart: '07:00', operatingEnd: '20:00', allowWeekends: false };

describe('operatingWindowFor', () => {
  it('uses policy hours on weekdays and closes weekends by default', () => {
    expect(operatingWindowFor({ operatingHours: null }, policy, 1)).toEqual({ open: '07:00', close: '20:00' });
    expect(operatingWindowFor({ operatingHours: null }, policy, 0)).toBeNull();
    expect(operatingWindowFor({ operatingHours: null }, { ...policy, allowWeekends: true }, 6)).toEqual({ open: '07:00', close: '20:00' });
  });

  it('resource override wins and missing days mean closed', () => {
    const hours = { '1': { open: '09:00', close: '18:00' }, '2': null };
    expect(operatingWindowFor({ operatingHours: hours }, policy, 1)).toEqual({ open: '09:00', close: '18:00' });
    expect(operatingWindowFor({ operatingHours: hours }, policy, 2)).toBeNull();
    expect(operatingWindowFor({ operatingHours: hours }, policy, 3)).toBeNull();
  });
});

describe('checkOperatingHours', () => {
  const tz = 'Asia/Kolkata';
  const at = (iso: string) => new Date(iso);
  it('accepts a booking inside hours', () => {
    expect(checkOperatingHours({ operatingHours: null }, policy, at('2026-11-02T03:30:00Z'), at('2026-11-02T11:30:00Z'), tz)).toEqual({ ok: true });
  });
  it('rejects bookings outside hours, on closed days and across midnight', () => {
    expect(checkOperatingHours({ operatingHours: null }, policy, at('2026-11-02T00:30:00Z'), at('2026-11-02T03:30:00Z'), tz).ok).toBe(false); // 06:00 start
    expect(checkOperatingHours({ operatingHours: null }, policy, at('2026-11-01T03:30:00Z'), at('2026-11-01T05:30:00Z'), tz).ok).toBe(false); // Sunday
    const r = checkOperatingHours({ operatingHours: null }, { ...policy, operatingEnd: '23:59', operatingStart: '00:00' }, at('2026-11-02T17:30:00Z'), at('2026-11-02T19:30:00Z'), tz);
    expect(r.ok).toBe(false); // 23:00 -> 01:00 next day
  });
});

describe('userCanAccessResource', () => {
  const open = { restrictedDepartmentIds: [], restrictedTeamIds: [] };
  const teamOnly = { restrictedDepartmentIds: [], restrictedTeamIds: ['t1'] };
  it('unrestricted resources are open to everyone', () => {
    expect(userCanAccessResource(open, undefined)).toBe(true);
  });
  it('restricted resources require membership or manage-any permission', () => {
    expect(userCanAccessResource(teamOnly, undefined)).toBe(false);
    expect(userCanAccessResource(teamOnly, { departmentId: null, teamId: 't2', permissions: [] })).toBe(false);
    expect(userCanAccessResource(teamOnly, { departmentId: null, teamId: 't1', permissions: [] })).toBe(true);
    expect(userCanAccessResource(teamOnly, { departmentId: null, teamId: null, permissions: ['reservation:manage-any'] })).toBe(true);
  });
});
