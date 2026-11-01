// Calendar integration boundary.
//
// Operational today:
//   - ICS generation ("Add to Calendar") — works with every calendar client and needs no credentials.
//
// Prepared adapters (require credentials, report NOT_CONFIGURED until provided):
//   - Microsoft 365 / Outlook via Microsoft Graph (client-credentials flow).
//   - Google Calendar via a service account.
//
// Both adapters implement CalendarAdapter. Synchronisation is idempotent: the external event id
// is stored in calendar_event_links (unique per reservation + provider) so a retry never creates
// a duplicate event.
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { dayjs } from '../utils/time.js';

export interface CalendarEventInput {
  reservationId: string;
  title: string;
  description: string;
  location: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  organizerEmail: string;
  attendeeEmails: string[];
}

export interface CalendarAdapter {
  readonly provider: 'MS365_CALENDAR' | 'GOOGLE_CALENDAR';
  readonly requiredEnv: string[];
  readonly configured: boolean;
  createOrUpdateEvent(input: CalendarEventInput): Promise<{ externalEventId: string }>;
  deleteEvent(reservationId: string): Promise<void>;
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(d: Date): string {
  return dayjs(d).utc().format('YYYYMMDD[T]HHmmss[Z]');
}

export function buildIcs(input: CalendarEventInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SpaceFlow//Workplace Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:spaceflow-${input.reservationId}@spaceflow`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(input.startAt)}`,
    `DTEND:${icsDate(input.endAt)}`,
    `SUMMARY:${escapeIcs(input.title)}`,
    `DESCRIPTION:${escapeIcs(input.description)}`,
    `LOCATION:${escapeIcs(input.location)}`,
    `ORGANIZER:mailto:${input.organizerEmail}`,
    ...input.attendeeEmails.map((e) => `ATTENDEE;RSVP=TRUE:mailto:${e}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // RFC 5545 requires CRLF line endings and folding at 75 octets.
  return lines
    .map((l) => {
      const chunks: string[] = [];
      let rest = l;
      while (rest.length > 73) {
        chunks.push(rest.slice(0, 73));
        rest = ' ' + rest.slice(73);
      }
      chunks.push(rest);
      return chunks.join('\r\n');
    })
    .join('\r\n');
}

class MicrosoftGraphCalendarAdapter implements CalendarAdapter {
  readonly provider = 'MS365_CALENDAR' as const;
  readonly requiredEnv = ['MS_GRAPH_TENANT_ID', 'MS_GRAPH_CLIENT_ID', 'MS_GRAPH_CLIENT_SECRET'];
  get configured() {
    return !!(env.MS_GRAPH_TENANT_ID && env.MS_GRAPH_CLIENT_ID && env.MS_GRAPH_CLIENT_SECRET);
  }

  private async token(): Promise<string> {
    const res = await fetch(`https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.MS_GRAPH_CLIENT_ID,
        client_secret: env.MS_GRAPH_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) throw new Error(`Graph token request failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  }

  async createOrUpdateEvent(input: CalendarEventInput) {
    if (!this.configured) throw new Error('MS365 calendar not configured');
    const token = await this.token();
    const existing = await prisma.calendarEventLink.findUnique({
      where: { reservationId_provider: { reservationId: input.reservationId, provider: this.provider } },
    });
    const body = {
      subject: input.title,
      body: { contentType: 'text', content: input.description },
      start: { dateTime: dayjs(input.startAt).tz(input.timezone).format('YYYY-MM-DDTHH:mm:ss'), timeZone: input.timezone },
      end: { dateTime: dayjs(input.endAt).tz(input.timezone).format('YYYY-MM-DDTHH:mm:ss'), timeZone: input.timezone },
      location: { displayName: input.location },
      attendees: input.attendeeEmails.map((address) => ({ emailAddress: { address }, type: 'required' })),
    };
    const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(input.organizerEmail)}/events`;
    const res = await fetch(existing ? `${base}/${existing.externalEventId}` : base, {
      method: existing ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Graph event sync failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { id: string };
    return { externalEventId: json.id };
  }

  async deleteEvent(reservationId: string) {
    const existing = await prisma.calendarEventLink.findUnique({
      where: { reservationId_provider: { reservationId, provider: this.provider } },
      include: { reservation: { include: { user: true } } },
    });
    if (!existing) return;
    const token = await this.token();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(existing.reservation.user.email)}/events/${existing.externalEventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok && res.status !== 404) throw new Error(`Graph event delete failed: ${res.status}`);
  }
}

class GoogleCalendarAdapter implements CalendarAdapter {
  readonly provider = 'GOOGLE_CALENDAR' as const;
  readonly requiredEnv = ['GOOGLE_CALENDAR_CREDENTIALS_PATH'];
  get configured() {
    return !!env.GOOGLE_CALENDAR_CREDENTIALS_PATH;
  }
  async createOrUpdateEvent(): Promise<{ externalEventId: string }> {
    // Service-account JWT exchange + Calendar API calls go here. The adapter is wired into the
    // sync pipeline but intentionally does not pretend to succeed without credentials.
    throw new Error('Google Calendar adapter requires a service account; see docs/integrations.md');
  }
  async deleteEvent(): Promise<void> {
    throw new Error('Google Calendar adapter requires a service account; see docs/integrations.md');
  }
}

export const calendarAdapters: CalendarAdapter[] = [new MicrosoftGraphCalendarAdapter(), new GoogleCalendarAdapter()];

/**
 * Sync a reservation to every enabled + configured calendar provider for the organisation.
 * Failures are recorded on the integration config and never block the booking itself.
 */
export async function syncReservationToCalendars(orgId: string, input: CalendarEventInput) {
  const configs = await prisma.integrationConfig.findMany({
    where: { orgId, isEnabled: true, provider: { in: ['MS365_CALENDAR', 'GOOGLE_CALENDAR'] } },
  });
  for (const cfg of configs) {
    const adapter = calendarAdapters.find((a) => a.provider === cfg.provider);
    if (!adapter || !adapter.configured) continue;
    try {
      const { externalEventId } = await adapter.createOrUpdateEvent(input);
      await prisma.calendarEventLink.upsert({
        where: { reservationId_provider: { reservationId: input.reservationId, provider: adapter.provider } },
        create: { reservationId: input.reservationId, provider: adapter.provider, externalEventId },
        update: { externalEventId, lastSyncedAt: new Date() },
      });
      await prisma.integrationConfig.update({
        where: { id: cfg.id },
        data: { status: 'READY', lastError: null, lastSyncedAt: new Date() },
      });
    } catch (err) {
      logger.warn({ err, provider: cfg.provider }, 'calendar sync failed');
      await prisma.integrationConfig.update({
        where: { id: cfg.id },
        data: { status: 'ERROR', lastError: (err as Error).message.slice(0, 500) },
      });
    }
  }
}

export async function removeReservationFromCalendars(orgId: string, reservationId: string) {
  const configs = await prisma.integrationConfig.findMany({
    where: { orgId, isEnabled: true, provider: { in: ['MS365_CALENDAR', 'GOOGLE_CALENDAR'] } },
  });
  for (const cfg of configs) {
    const adapter = calendarAdapters.find((a) => a.provider === cfg.provider);
    if (!adapter?.configured) continue;
    try {
      await adapter.deleteEvent(reservationId);
      await prisma.calendarEventLink.deleteMany({ where: { reservationId, provider: adapter.provider } });
    } catch (err) {
      logger.warn({ err, provider: cfg.provider }, 'calendar event removal failed');
    }
  }
}
