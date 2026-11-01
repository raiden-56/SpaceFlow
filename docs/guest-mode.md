# Guest mode

Guest mode lets anyone try SpaceFlow without an account. On the sign-in page, **Continue as guest** creates a private workspace full of realistic demo data and signs the visitor in. Every feature works exactly as for a signed-in user, including booking, the 3D explorer, check-in, approvals and the full admin portal, because it all runs on the real API and database.

## How it works

1. `POST /api/v1/auth/guest` (no credentials; rate-limited like login) creates a new organisation with slug `guest-<random id>` using the same generator as the development seed (`apps/api/src/lib/demoData.ts`):
   - 2 buildings (Bengaluru, Zurich) and 6 published floors with floor plans;
   - about 200 desks and 17 meeting rooms with amenities;
   - departments, teams and 17 colleagues;
   - booking policies and an approval-required boardroom;
   - about 250 past, current, upcoming, cancelled and pending reservations;
   - favourites, notifications and announcements.
2. The visitor becomes **Guest Explorer**, with role `ORG_ADMIN` in that sandbox, so the admin portal can be explored too. The response is a normal session: an access token plus an HttpOnly refresh cookie.
3. `GET /auth/me` returns `isGuest: true` and `guestExpiresAt`. The web app shows a banner in both portals ("Guest mode… your sandbox is deleted automatically in N hours") with a **Sign in with an account** action.
4. Each guest gets their own sandbox, so two visitors never see each other's changes.

Creating a sandbox takes about two seconds.

## Isolation and safety

- Every API query is scoped to the organisation in the access token. Guests cannot read or change any other organisation, and other organisations cannot see sandboxes. Integration tests assert this, including direct-ID access returning 404.
- Sandbox users, including the generated colleagues and admin, have a locked password hash, so nobody can sign in to a sandbox with a password. The only way in is the guest session that created it.
- Guest sessions follow the same refresh rotation and revocation rules as normal ones.
- Emails generated inside a sandbox go to `*@guest-<id>.guest.local` addresses, which are not deliverable.

## Lifetime and cleanup

The background scheduler deletes sandboxes older than `GUEST_SANDBOX_TTL_HOURS` (default 24), with every reservation, user, resource and upload record in them, purging up to 20 per tick. See [operations.md](operations.md#guest-sandbox-purge).

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `GUEST_MODE_ENABLED` | `true` | When `false`, the button is hidden (`GET /auth/guest/status` reports `enabled: false`) and `POST /auth/guest` returns 403 |
| `GUEST_SANDBOX_TTL_HOURS` | `24` | Sandbox lifetime (1–168) |

Turn guest mode off on internal production deployments unless public demos are wanted. Each sandbox holds a few thousand rows, which the login rate limit (20 per 15 minutes per IP) and the purge keep bounded.

## Changing the demo data

Edit `apps/api/src/lib/demoData.ts`. The development seed (`pnpm db:seed`), guest sandboxes and the API and E2E test fixtures all use it, so new demo content appears everywhere.
