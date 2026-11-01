# SpaceFlow

Smart office booking and 3D workplace management. Employees explore their buildings in 3D, 2D or as a list, find a free desk or meeting room and book it in a few clicks. Workplace administrators manage buildings, floors, floor plans, resources, booking policies and reports from a dedicated admin portal.

Every action is backed by a real API and a PostgreSQL database. There is no mock data in the app; demo data comes from seed scripts, and guest mode provisions a private copy of it per visitor.

## Features

**Employees**

- **Dashboard** with today's desk, upcoming meetings, the next booking with a countdown, live availability for the selected building, favourites, recent and suggested desks, and announcements.
- **3D / 2D / list explorer**: an interactive building (orbit, zoom, pan, reset, fullscreen, exploded floors), animated camera moves to a floor or desk, an equivalent 2D floor plan with pan and zoom, and a keyboard-accessible list. All three views share one booking context and one details panel.
- **Book a Seat** with filters (window, elevators, monitor, docking station, height-adjustable, accessible, quiet zone, amenities, near my teammates), "Find me a seat" suggestions, and **booking from the in-page floor map**: pick a desk on the plan and the details panel opens beside it.
- **Book my usual seat again** in one click.
- **Teammates on the map**: badges show where teammates sit (when they share their location), and "Sit near <name>" selects the closest free desk.
- **Meeting Rooms**: search by date, time, duration, attendees, amenities, room type and accessibility, ranked by capacity fit. Results show as cards or a list, or rooms can be **picked on the map**.
- **Booking dialog** with **quick time presets** (full day, morning, afternoon), quick date chips (today, tomorrow), recurring bookings, multi-day bookings including **"Rest of the week"**, attendees and setup requests. The confirmation step shows a **read-only location preview** of where the desk or room is. A conflict returns alternatives, and multi-date results report which dates failed.
- **My Bookings**: upcoming, ongoing, past and cancelled tabs with filters, search and pagination. Actions include details, view on map, modify, cancel (the record is kept), check-in and check-out, add to calendar (.ics), and book again.
- **QR check-in** from a phone or kiosk; check-in reminders and **automatic release** of no-shows after the grace period.
- **Approvals** for restricted rooms; approvers see and decide pending requests.
- **Global search** across buildings, floors, desks, rooms, amenities, facilities and people. Also an office directory showing where colleagues sit today (privacy-aware), an in-app notification centre with live updates, and profile and preference settings.
- **Guest mode**: "Continue as guest" opens a private sandbox organisation with full demo data. Every feature works, including the admin portal, and the sandbox is deleted after 24 hours (see [docs/guest-mode.md](docs/guest-mode.md)).

**Administrators**

- Overview and **analytics**: occupancy, booking volume, utilization trends, peak hours, cancellation, check-in and no-show rates, top resources, floor utilization and building comparison.
- **Buildings and floors**: time zones, activation, floor ordering, publish and unpublish, and GLB building models.
- **Map Studio**: an SVG floor-plan editor with background images, a palette of every object kind, drag, resize, rotate, numeric properties, links to real desks and rooms, auto-placement, an availability overlay, zones, validation, and save, publish and unpublish. Replacing a plan keeps resource identity and booking history.
- **Seats and meeting rooms**: CRUD, amenities, restrictions, operating hours, maintenance windows, bulk updates, CSV import (dry run first) and export, and reservation history.
- **Employees and teams**: invitations, roles, activation and per-user booking history.
- **Reservations**: search, cancel with a reason, check-in records, conflict investigation and CSV export.
- **Booking policies**: advance window, durations, limits, hours, weekends, cancellation deadline, check-in grace and auto-release, recurring and multi-day rules, with an effective-policy inspector.
- **Announcements, audit log, integrations status and organisation settings.**

## Architecture

```
apps/web         React 19 + Vite + MUI 9 + Redux Toolkit / RTK Query + React Three Fiber
apps/api         Node 22 + Express 5 + Prisma 6 + PostgreSQL 16 (modular monolith)
packages/shared  Zod schemas, enums, permissions and DTO types shared by both apps
infrastructure   Dockerfiles, nginx config, Postgres init SQL
tests/e2e        Playwright end-to-end tests
docs             Architecture, deployment, operations, security, integrations, testing, OpenAPI
```

- One booking engine handles every booking path. Overlaps are prevented by a PostgreSQL `EXCLUDE USING gist` constraint on `(resource_id, tstzrange(start_at, end_at, '[)'))` for active reservations, so concurrent requests cannot both succeed.
- Real-time availability uses Server-Sent Events; clients refetch on events, and the API stays the source of truth.
- Background jobs (reminders, check-in reminders, no-show release, completion, token cleanup and guest sandbox purge) run in-process under a PostgreSQL advisory lock.

Details are in [docs/architecture.md](docs/architecture.md). The API contract is in [docs/openapi.json](docs/openapi.json); a running API also serves it at `/api/v1/openapi.json`, with Swagger UI at `/api/v1/docs`.

## Prerequisites

- Node.js 22 or later (developed on 24)
- pnpm 11 (`corepack enable && corepack prepare pnpm@11.18.0 --activate`)
- Docker (for PostgreSQL, and optionally the full stack)

## Getting started

```bash
pnpm install                     # installs all workspaces; Prisma/esbuild build scripts are pre-approved
cp .env.example .env             # root .env (Docker Compose)
cp .env apps/api/.env            # the API reads apps/api/.env
pnpm db:up                       # PostgreSQL 16 on localhost:5444 (+ spaceflow_test database)
pnpm db:migrate                  # apply migrations (includes the overlap constraint)
pnpm db:seed                     # demo data (wipes the dev database first)
pnpm dev                         # API on :4000 and web on :5173 (Vite proxies /api to the API)
```

Open http://localhost:5173 and sign in with a demo account or choose **Continue as guest**.

### Demo accounts (seeded, development only)

| Role | Email | Password |
| --- | --- | --- |
| Employee | employee@spaceflow.local | Password123! |
| Organization admin | admin@spaceflow.local | Admin123! |
| Workplace admin | facilities@spaceflow.local | Password123! |
| Approver | approver@spaceflow.local | Password123! |

The seed creates 2 buildings, 6 floors, 208 desks, 17 meeting rooms, 17 users and about 250 past, current, upcoming and cancelled reservations. Change the passwords with `SEED_*` variables. Never run the seed against production; it refuses when `NODE_ENV=production`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | API (tsx watch) and web (Vite) together |
| `pnpm dev:api` / `pnpm dev:web` | One app only |
| `pnpm typecheck` | TypeScript in every workspace |
| `pnpm test` | All unit and integration tests (API needs the database) |
| `pnpm test:unit` | API unit tests and web tests, no database needed |
| `pnpm test:api` / `pnpm test:web` | One app's tests |
| `pnpm e2e:install` | Download Playwright's Chromium |
| `pnpm test:e2e` | Playwright E2E: starts its own API (port 4100, test DB) and web (port 5180) |
| `pnpm build` | Production builds: web to `apps/web/dist`, API bundled to `apps/api/dist/server.js` |
| `pnpm verify` | `typecheck`, then `test:unit`, then `build` |
| `pnpm db:up` / `db:migrate` / `db:seed` / `db:reset` | Database lifecycle |
| `pnpm openapi:export` | Regenerate `docs/openapi.json` |

**E2E behind a corporate proxy.** If `pnpm e2e:install` fails with a certificate error, run the suite on an installed browser instead:

```bash
E2E_CHANNEL=msedge pnpm test:e2e      # or E2E_CHANNEL=chrome
```

### Full stack in Docker

The API image runs in production mode, so it needs real JWT secrets. The example below uses host ports 4001 (API) and 8081 (web) to avoid clashing with a dev server.

```bash
export JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
export JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
API_HOST_PORT=4001 WEB_PORT=8081 docker compose --profile full up -d --build
# Web: http://localhost:8081 (nginx serves the SPA and proxies /api)   API: http://localhost:4001/api/v1/health
docker compose --profile full rm -sf api web   # stop the app containers but keep PostgreSQL running
```

The API container applies migrations on start (`RUN_MIGRATIONS=false` disables this). Seed it from the host with `pnpm db:seed` if you want demo data. See [docs/deployment.md](docs/deployment.md).

## Environment variables

The API reads `apps/api/.env`; Docker Compose reads the root `.env`. See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables strict CORS and secure cookies, and refuses placeholder secrets |
| `DATABASE_URL` | `postgresql://spaceflow:spaceflow@localhost:5444/spaceflow` | Main database |
| `TEST_DATABASE_URL` | `.../spaceflow_test` | Isolated database for integration and E2E tests (used when `NODE_ENV=test`) |
| `API_PORT` | `4000` | API port |
| `API_BASE_URL` | `http://localhost:4000` | Public API origin, used for asset URLs |
| `WEB_ORIGIN` | `http://localhost:5173` | Comma-separated allowed browser origins (CORS) and link base for emails |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | placeholders | 32+ characters; must be real random values in production |
| `ACCESS_TOKEN_TTL` | `15m` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `14` | Refresh token lifetime |
| `COOKIE_SECURE` | `false` | Force `Secure` cookies outside production |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` | `./uploads` / `25` | Floor-plan image and GLB storage, and the size limit |
| `LOG_LEVEL` | `info` | pino log level |
| `JOBS_ENABLED` / `JOBS_INTERVAL_SECONDS` | `true` / `30` | Background scheduler |
| `REDIS_URL` | empty | Reserved for multi-instance scaling; not required |
| `SENTRY_DSN` | empty | Sentry-compatible error reporting |
| `GUEST_MODE_ENABLED` | `true` | Show "Continue as guest" and allow sandbox creation |
| `GUEST_SANDBOX_TTL_HOURS` | `24` | Guest sandboxes are purged after this many hours |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_USER_PASSWORD` | demo values | Seed script only |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `SMTP_FROM` | empty | Email delivery; when empty, emails go to the API log |
| `OIDC_ISSUER_URL` `OIDC_CLIENT_ID` `OIDC_CLIENT_SECRET` `OIDC_REDIRECT_URI` | empty | Enterprise SSO (OpenID Connect) |
| `MS_GRAPH_TENANT_ID` `MS_GRAPH_CLIENT_ID` `MS_GRAPH_CLIENT_SECRET` | empty | Microsoft 365 calendar and Teams |
| `GOOGLE_CALENDAR_CREDENTIALS_PATH` | empty | Google Calendar service account (prepared boundary) |
| `VITE_API_URL` | empty | Web build only. Leave empty to call the API on the same origin (Vite proxy in dev, nginx in Docker). Vite reads it from `apps/web/.env` or the build environment, not from the root `.env`. |

## Troubleshooting

- **Port 5173 is already in use.** Vite moves to 5174 (or the next free port). In development the API accepts any `localhost` / `127.0.0.1` origin, so the app keeps working. In production only `WEB_ORIGIN` is allowed, and other origins get a 403.
- **`pnpm install` warns about ignored build scripts, or Prisma Client is missing.** Build scripts for `@prisma/client`, `@prisma/engines`, `prisma` and `esbuild` must be approved under `allowBuilds` in `pnpm-workspace.yaml` (they already are). Then run `pnpm install` again, or `pnpm --filter @spaceflow/api db:generate`.
- **`prisma generate` fails with `EPERM ... query_engine-windows.dll.node`.** A running API process holds the engine file on Windows. Stop the dev API and retry.
- **Reset the development database:** `pnpm db:reset` drops everything, re-applies migrations and reseeds. To start from an empty volume, run `docker compose down -v` (this deletes all local data).
- **Login works but every page reload signs you out.** Refresh tokens rotate and reuse is detected. Clear the site's cookies, and make sure only one dev server talks to the same API and database.
- **The 3D view is greyed out.** WebGL is unavailable (some VMs and remote desktops). The app switches to the 2D plan automatically, and the list view always works.

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Operations, backup and recovery](docs/operations.md)
- [Security](docs/security.md)
- [Integrations](docs/integrations.md)
- [Testing](docs/testing.md)
- [Guest mode](docs/guest-mode.md)
