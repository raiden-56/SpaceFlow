# Integrations

Each integration sits behind an adapter in `apps/api/src/integrations/`. Credentials come only from environment variables. The admin portal (**Integrations**) shows per-provider status (`NOT_CONFIGURED`, `READY`, `DISABLED` or `ERROR`), the required variables, and the last error and sync time. Enabling a provider whose variables are missing is refused with `501 INTEGRATION_NOT_CONFIGURED`. A failing integration never blocks a booking; the failure is recorded on the integration's status.

| Integration | Status | Needs |
| --- | --- | --- |
| Add to calendar (.ics download) | **Operational** | Nothing |
| QR check-in | **Operational** | Nothing |
| Email (SMTP) | **Operational** with a mail server; logs emails otherwise | `SMTP_*` |
| Microsoft 365 / Outlook calendar (Graph) | **Implemented, untested against a live tenant** | Azure app registration |
| Microsoft Teams | **Not implemented** (status only) | Graph credentials |
| Google Calendar | **Prepared boundary only**: refuses to sync | Service account (not wired) |
| Enterprise SSO (OpenID Connect) | **Implemented**, needs an identity provider | `OIDC_*` |

## Add to calendar (ICS)

`GET /api/v1/reservations/:id/ics` returns an RFC 5545 event with CRLF line endings, 75-octet folding and escaping. The UID is `spaceflow-<reservationId>`, so re-importing updates the event instead of duplicating it. It includes location, check-in code and attendees. This works with Outlook, Google Calendar, Apple Calendar and others without any configuration; the web app offers it as **Add to calendar** on a booking.

## QR check-in

Every reservation has a random check-in code (for example `7K3M-Q9ZD`). `GET /reservations/:id/qr` returns a PNG data URL encoding `<WEB_ORIGIN>/check-in?reservation=<id>&code=<code>`. Opening that link checks the booking in:

- by the owner on their phone;
- by anyone holding the correct code (a kiosk or shared device), who then sees the booking they checked in.

Check-in opens `checkInOpensMinutesBefore` minutes before the start (policy). Bookings that require check-in but don't get one within `checkInGraceMinutes` are released automatically. No external service is involved.

## Email (SMTP)

- **Not configured** (`SMTP_HOST` empty): emails are written to the API log (`[email:log]`). This is the local development default, so reset and invite links appear in the log.
- **Configured:** a built-in SMTP client (no third-party library) sends multipart text and HTML over implicit TLS (port 465) or STARTTLS (other ports), with `AUTH PLAIN` when `SMTP_USER` is set.
- Booking confirmations, cancellations, changes, reminders, releases and approval decisions are emailed when the user has email notifications enabled. Invitations and password resets are always sent.
- **Variables:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
- **Limitations:** there is no retry queue, so a failed send is logged and dropped. For guaranteed delivery, point SMTP at a relay that queues (Postfix, SES, SendGrid SMTP and so on).

## Microsoft 365 / Outlook calendar

- **Implemented** in `integrations/calendar.ts` (`MicrosoftGraphCalendarAdapter`). It uses a client-credentials token and creates or updates the event in the organizer's mailbox (`/users/{email}/events`) with time zone, location and attendees.
- **Deduplication:** the event ID is stored in `calendar_event_links` (unique per reservation and provider), so a retry updates instead of duplicating. Cancelling a booking deletes the event.
- **When it runs:** syncing happens after a confirmed meeting-room booking, only when the provider is enabled in the admin portal and configured.
- **Status:** the code is complete but has **not been exercised against a real tenant** in this repository's tests. Validate it in a test tenant before relying on it.
- **Setup:**
  1. Register an app in Microsoft Entra ID.
  2. Add the application permission `Calendars.ReadWrite` and grant admin consent. Restrict it to the relevant mailboxes with an application access policy.
  3. Create a client secret.
  4. Set `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID` and `MS_GRAPH_CLIENT_SECRET`.
  5. Enable **Microsoft 365 calendar** under Admin, then Integrations.
- **Teams:** its status card uses the same Graph variables, but no Teams-specific behaviour (meeting links or channel posts) is implemented.

## Google Calendar

This is a **prepared boundary only**. `GoogleCalendarAdapter` reports configured when `GOOGLE_CALENDAR_CREDENTIALS_PATH` is set, but its sync methods deliberately throw ("requires a service account"), so it never claims a successful sync. The failure is recorded on the integration status.

Implementing it means a service-account JWT exchange (with domain-wide delegation to impersonate the organizer) and Calendar API `events.insert`, `patch` and `delete` calls, using the same `calendar_event_links` deduplication.

## Enterprise SSO (OpenID Connect)

- **Implemented** in `integrations/sso.ts` and `/api/v1/auth/sso/*`. It uses discovery (`/.well-known/openid-configuration`), the authorization-code flow with PKCE (S256) and state, and ID-token verification against the provider's JWKS (issuer and audience).
- **Account matching:** users are matched by the `email` claim and must already exist and not be deactivated (no just-in-time provisioning). A successful login sets the normal refresh cookie and passes a 60-second access token to the SPA in the URL fragment.
- **Setup:**
  1. Register a web client with redirect URI `https://<api-origin>/api/v1/auth/sso/callback` and scopes `openid email profile`.
  2. Set `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_REDIRECT_URI`.
  3. The login page shows **Continue with company SSO** once `/auth/sso/status` reports enabled.
- **Limitations:**
  - The PKCE state is kept in memory, so use a single instance or sticky sessions for `/auth/sso/*`.
  - Local passwords stay enabled alongside SSO.
  - There is no automated test against a real identity provider in this repository.

## Real-time and Redis

Server-Sent Events work without Redis. `REDIS_URL` is reserved for a future cross-instance event fan-out and shared SSO state, and is not used by the current code. See [deployment.md](deployment.md#scaling).
