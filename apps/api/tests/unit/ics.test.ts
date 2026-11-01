import { describe, expect, it } from 'vitest';
import { buildIcs } from '../../src/integrations/calendar.js';

describe('buildIcs', () => {
  const ics = buildIcs({
    reservationId: '11111111-1111-1111-1111-111111111111',
    title: 'Sprint planning; Q4',
    description: 'Line one\nLine two, with comma. This description is intentionally long enough to require RFC 5545 line folding at seventy-five octets.',
    location: 'Orion, Level 1, Harbor Tower',
    startAt: new Date('2026-11-02T03:30:00Z'),
    endAt: new Date('2026-11-02T04:30:00Z'),
    timezone: 'Asia/Kolkata',
    organizerEmail: 'sam@example.com',
    attendeeEmails: ['a@example.com', 'b@example.com'],
  });

  it('produces a valid VCALENDAR with UTC times and escaped text', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261102T033000Z');
    expect(ics).toContain('DTEND:20261102T043000Z');
    expect(ics).toContain('SUMMARY:Sprint planning\\; Q4');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\, with comma.');
    expect(ics).toContain('UID:spaceflow-11111111-1111-1111-1111-111111111111@spaceflow');
    expect(ics.match(/ATTENDEE;RSVP=TRUE:mailto:/g)).toHaveLength(2);
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
  });

  it('folds lines longer than 75 octets', () => {
    const lines = ics.split('\r\n');
    expect(lines.every((l) => l.length <= 75)).toBe(true);
    const folded = lines.findIndex((l) => l.startsWith(' '));
    expect(folded).toBeGreaterThan(0);
    // Unfolding restores the original content.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('seventy-five octets.');
  });
});
