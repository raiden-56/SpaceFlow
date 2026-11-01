# Testing

| Layer | Tool | Where | Count |
| --- | --- | --- | --- |
| API unit | Vitest (project `unit`) | `apps/api/tests/unit` | 8 files |
| API integration | Vitest (project `integration`) + supertest | `apps/api/tests/integration` | 8 files |
| Web unit and component | Vitest + Testing Library (jsdom) | `apps/web/src/**/__tests__` | 18 tests |
| End-to-end | Playwright | `tests/e2e` | 19 tests (18 desktop Chromium + 1 Pixel 5 mobile) |

In total the API suite has 91 tests in 16 files.

## API tests

```bash
pnpm db:up                                   # PostgreSQL on :5444 (creates spaceflow_test too)
pnpm --filter @spaceflow/api test            # unit + integration
pnpm --filter @spaceflow/api test:unit       # no database needed
pnpm --filter @spaceflow/api test:integration
```

**Unit tests** cover:

- time-zone and DST helpers and half-open overlap;
- recurring and multi-day expansion;
- operating hours, restrictions and availability rules;
- password hashing and check-in codes;
- CSV parsing, ICS generation, shared Zod schemas, and the OpenAPI document shape.

**Integration tests** run the Express app in-process through supertest, so no port is opened, against the isolated test database (`TEST_DATABASE_URL`, selected because `NODE_ENV=test`). The global setup creates and migrates the test database, and each file truncates it and reseeds the demo organisation. Coverage:

- **auth:** login, refresh rotation and reuse detection, CSRF header, logout, password reset and change, SSO and guest status;
- **rbac:** 401 and 403 matrix, approver and workplace-admin limits, last-org-admin protection, published-only visibility, cross-user reads;
- **reservations:** create, overlap 409 with alternatives, back-to-back, policy violations, recurring partial success, atomic rollback, modify, cancel, check-in and QR kiosk check-in, approvals, favourites, notifications, admin on-behalf booking and cancel;
- **concurrency:** 10 parallel requests produce exactly one 201; overlapping windows never coexist; direct SQL inserts hit `reservations_no_overlap` (23P01) and `reservations_valid_range`;
- **admin:** building and floor creation, seat and room creation, Map Studio validation, publish and identity-preserving replace, CSV import dry run and commit, upload validation (415, 413, 403), audit entries, archive blocked by active bookings;
- **guest and jobs:** sandbox isolation, separate sandboxes per guest, disabling via `GUEST_MODE_ENABLED`, purge; reminders, no-show release and completion with an injected clock;
- **workplace and teammates:** floor maps, availability states, filters, day slots, suggestions, search, dashboard, directory privacy, and team seat locations.

## Web tests

```bash
pnpm --filter @spaceflow/web test
```

These are component tests with the real store, theme and router, mocking `fetch` (`src/test/render.tsx`). Pure helpers covered include 3D geometry, nearest free desk and Map Studio utilities.

## End-to-end tests

```bash
pnpm e2e:install                    # once: download Playwright Chromium
pnpm test:e2e                       # desktop + mobile projects
E2E_CHANNEL=msedge pnpm test:e2e    # use installed Edge/Chrome (e.g. behind a TLS-intercepting proxy)
pnpm test:e2e --project chromium booking.spec.ts      # a subset
```

`tests/e2e/playwright.config.ts` starts an isolated stack, so the development database is never touched:

- an **API** on `127.0.0.1:4100` with `NODE_ENV=test` (test database; rate limits and background jobs off);
- **Vite** on `127.0.0.1:5180` (`--strictPort`), proxying `/api` to that API;
- a **global setup** that migrates and reseeds the test database before each run.

Override the ports with `E2E_API_PORT` and `E2E_WEB_PORT`. To test an existing deployment, set `E2E_BASE_URL`; local servers and the reseed are then skipped. Do not run the integration tests at the same time, because both use the test database.

Sessions are not shared through stored state. Refresh tokens rotate and reuse revokes all sessions, so each test signs in through the API in its own browser context (`helpers.ts`: `loginAs`, `loginAsGuest`). Admin specs run as a guest (`ORG_ADMIN` of a private sandbox), so they never modify the seeded organisation.

| Spec | Covers |
| --- | --- |
| `auth.spec.ts` | Form login, wrong password, reload keeps the session, sign out, employee blocked from `/admin`, guest mode |
| `booking.spec.ts` | 2D plan and list navigation; desk booking, then My Bookings, view on map and cancel; meeting room with a title; 30-day advance-window rejection; changing the date in the dialog; mobile (Pixel 5) desk booking |
| `booking-map.spec.ts` | Sidebar DOM node persists across navigation; booking a desk from the Book a Seat map with presets and location preview; picking a room on the Meeting Rooms map; view toggles |
| `admin.spec.ts` | Overview; create building and floor; create seat; Map Studio save and publish |

Tests use `data-testid`s and roles with web-first assertions, with no fixed sleeps. Dates are computed relative to today in business days, so weekends and the seed's seven-day booking horizon are avoided. Failures keep a trace and screenshot in `test-results/`; CI uploads them with the HTML report.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request:

- typecheck;
- API tests against a `postgres:16` service;
- web tests and build;
- the API production bundle;
- Playwright on Chromium (report uploaded);
- a build of both Docker images.

## Verification before a release

```bash
pnpm verify        # typecheck → API unit + web tests → production builds
pnpm test:api      # integration tests (database required)
pnpm test:e2e
```
