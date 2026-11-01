# Architecture

SpaceFlow is a modular monolith: one API process and one single-page web app over one PostgreSQL database. Module boundaries are folders with their own routes and services, so a module can be extracted later without changing the contract.

```
Browser (React SPA)
  │  HTTPS, same origin: /api/* is proxied (Vite in dev, nginx in Docker)
  ▼
API (Express 5, Node 22)
  ├─ REST /api/v1/*           validation (Zod) → auth (JWT) → permission check → service
  ├─ SSE  /api/v1/events      availability / notification / floor-plan events
  └─ Scheduler (in-process)   reminders, no-show release, completion, purge (advisory lock)
  ▼
PostgreSQL 16  (Prisma 6; btree_gist exclusion constraint for overlap protection)
Local disk     uploads (floor-plan images, GLB models)
```

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/shared` | Zod schemas (request validation on both sides), enums, the role → permission map, DTO types |
| `apps/api/src/modules` | `auth`, `users`, `buildings` (buildings and floors), `resources` (seats, rooms, amenities, availability), `reservations` (booking engine), `availability`, `policies`, `notifications`, `search`, `dashboard`, `assets`, `realtime`, `admin` (workplace, people, governance), `system` (health, OpenAPI) |
| `apps/api/src/integrations` | Email (log or SMTP), calendar (ICS, Microsoft Graph, Google boundary), OIDC SSO |
| `apps/api/src/jobs` | Scheduler |
| `apps/api/src/lib/demoData.ts` | Demo dataset used by both the seed and guest mode |
| `apps/api/prisma` | Schema, migrations, seed |
| `apps/web/src/features` | One folder per screen group: dashboard, map3d, seats, meeting-rooms, bookings, directory, notifications, settings, admin, auth |
| `apps/web/src/components/common` | Shared UI: booking dialog, resource details panel, cards, floor selector, legend, criteria bar, layouts' outlet |
| `apps/web/src/services` | RTK Query API slice, typed endpoints, SSE client |

## Data model (summary)

- **Tenancy:** `Organization` owns users, departments and teams, buildings, amenities, policies, resources, reservations, assets, audit logs, integrations and announcements. Every query is scoped by `orgId` taken from the access token, never from the request.
- **People:** `User` with `UserRole` (roles `EMPLOYEE`, `APPROVER`, `WORKPLACE_ADMIN`, `ORG_ADMIN`) and `RolePermission`; `UserPreference`; `RefreshToken` (hashed, rotated).
- **Workplace:** `Building` (IANA `timezone`) → `Floor` → `FloorPlan` (size in metres, status, version, image or model asset) → `MapObject` (kind, position, size, rotation, optional `resourceId`); `Zone`.
- **Resources:** `Resource` (`SEAT` or `MEETING_ROOM`; status, bookable, approval, capacity, seat attributes, operating hours, max duration, check-in override, department and team restrictions) with `ResourceAmenity` and `MaintenanceWindow`. Archived resources are soft-deleted, so history keeps pointing at them.
- **Bookings:** `Reservation` (UTC `startAt`/`endAt`, building time zone, status, check-in code, series), `ReservationSeries`, `ReservationAttendee`, `CheckInRecord`, `ApprovalRequest`, `CalendarEventLink`.
- **Other:** `BookingPolicy`, `Notification`, `Favorite`, `Announcement`, `AuditLog`, `IntegrationConfig`, `JobRun`, `Asset`.

Reservation statuses: `PENDING_APPROVAL`, `CONFIRMED`, `CHECKED_IN` (these three are "active" and occupy the resource), plus `COMPLETED`, `CANCELLED`, `REJECTED`, `NO_SHOW` and `RELEASED`. Cancelling never deletes a row.

## Booking engine

All create, modify, cancel, check-in and approval paths go through `apps/api/src/modules/reservations/service.ts`.

1. **Resolve the effective policy** (`policies/service.ts`), most specific first: building + resource type, then building, then resource type, then organisation default, then built-in default.
2. **Expand occurrences** for recurring rules (daily or weekly, interval, weekdays, until or count) and additional dates. Each occurrence keeps the same wall-clock time in the building's time zone, so DST changes are handled.
3. **Validate each occurrence:** not in the past, minimum and maximum duration, advance window, operating hours (resource override, otherwise policy; weekends), capacity, maintenance windows, the user's active, daily and weekly limits, one seat per person at a time, and department or team restrictions. Approval-required resources start as `PENDING_APPROVAL`.
4. **Pre-check conflicts** for a friendly 409 with up to three alternatives on the same floor or in the same building.
5. **Insert inside a transaction.** The PostgreSQL constraint `reservations_no_overlap` (`EXCLUDE USING gist (resource_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE status IN active`) is the final authority: of two concurrent requests, one fails with SQLSTATE 23P01 and is returned as `BOOKING_CONFLICT`. Intervals are half-open, so 09:00–10:00 and 10:00–11:00 do not conflict.
6. **Batches:** `atomic: true` (default) rolls back everything if any occurrence fails. `atomic: false` books what it can and returns `{ created, failed[] }` with a reason per date.
7. **After commit:** notifications (in-app plus email), audit entries, an SSE `availability.changed` broadcast, and best-effort calendar sync.

Availability (`availability/service.ts`) is computed in one place for every view. A resource is `DISABLED` (inactive, unpublished floor, inactive building or maintenance), `OCCUPIED` (an active booking is in progress now), `RESERVED` (overlaps the requested window), `RESTRICTED` (needs approval, or is limited to a team the user isn't in), or `AVAILABLE`.

## Real-time updates

`POST /events/ticket` issues a 60-second token, because `EventSource` cannot send headers. `GET /events?ticket=` then streams `availability.changed`, `notification.created`, `floorplan.published` and a 25-second heartbeat. The web client invalidates RTK Query tags on each event, so the 3D scene, 2D plan, lists, cards and dashboard refetch. It reconnects with exponential backoff and refetches once after each reconnect. Events are hints only; correctness never depends on them.

Clients connected to one API instance only receive events published by that instance. For more than one instance, see [deployment.md](deployment.md#scaling).

## Background jobs

`apps/api/src/jobs/scheduler.ts` ticks every `JOBS_INTERVAL_SECONDS` (default 30). Each tick takes `pg_try_advisory_lock`, so only one instance runs it, records a `JobRun`, and executes:

- the upcoming-booking reminder (one hour ahead, sent once);
- the check-in reminder or no-show warning when a booking starts;
- no-show release once the grace period has passed (`RELEASED`, audited, user notified);
- completion of ended bookings (`CHECKED_IN` becomes `COMPLETED`; an unattended `CONFIRMED` becomes `NO_SHOW` when check-in is required; an expired `PENDING_APPROVAL` becomes `REJECTED`);
- cleanup of expired and revoked refresh tokens;
- purging of guest sandboxes older than `GUEST_SANDBOX_TTL_HOURS`.

Each job function takes an injectable `now`, which the tests use.

## Guest sandboxes

`POST /auth/guest` provisions a complete organisation (slug `guest-<id>`) from `lib/demoData.ts` and signs the visitor in as its `ORG_ADMIN`. Because every query is org-scoped, a sandbox is fully isolated, and every feature, including admin, runs on the real code paths. See [guest-mode.md](guest-mode.md).

## Web application

- **Routing:** layouts (employee, admin, auth) stay mounted. Each layout renders a `ContentOutlet` that owns the `Suspense` boundary, so only the content area shows a loading bar during navigation. Feature pages are code-split and preloaded after sign-in.
- **State:** RTK Query for server state, with tag-based invalidation after mutations and SSE events. Two slices: `auth` (access token and user) and `booking` (the shared building, floor, date, time window, view mode and selected resource). Switching between Dashboard, Explore, Book a Seat and Meeting Rooms keeps that context.
- **Auth:** the access token lives in memory; the refresh token is an HttpOnly cookie. A 401 triggers one shared refresh request, then a retry.
- **3D:** React Three Fiber with drei `CameraControls`. Desks are an `InstancedMesh` coloured by availability. Optional GLB models load lazily with a fallback to the generated geometry, and the frame loop runs on demand. The 2D plan (SVG) and the list are equivalent, fully keyboard-operable alternatives.
- **Design system:** an MUI 9 theme with the brand palette and status colours from `packages/shared/src/constants.ts`. Status is always shown with text or an icon, not colour alone. Reduced motion is respected through MUI and `framer-motion`'s `MotionConfig`.
