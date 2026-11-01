# Security

## Authentication

- **Passwords** are hashed with scrypt (N=16384, r=8, p=1, 64-byte key, random salt per user). Comparison runs in constant time. Plaintext passwords are never stored or logged, and login runs the hash check even for unknown emails to avoid timing-based user enumeration.
- **Access token:** an HS256 JWT (issuer `spaceflow`, audience `spaceflow-web`) carrying user, org, roles, permissions, department and team. The default lifetime is 15 minutes (`ACCESS_TOKEN_TTL`). The web app keeps it in memory only.
- **Refresh token:** 48 random bytes, stored as a SHA-256 hash in `refresh_tokens`, and sent as an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/v1/auth`. It is `Secure` in production or with `COOKIE_SECURE=true`. The default lifetime is 14 days.
  - **Rotation:** every `/auth/refresh` revokes the presented token and issues a new one.
  - **Reuse detection:** presenting an already-revoked token revokes every active session of that user (likely token theft). The web client shares one in-flight refresh per tab, so its own concurrent refreshes cannot trigger this.
  - **Revocation:** logout revokes the current token. Password change or reset, deactivation, deletion and role changes revoke all of a user's sessions.
- **Password reset and invitations** use single-use random tokens stored hashed, valid for 1 hour (reset) or 7 days (invite). The forgot-password endpoint always gives the same response, so it cannot be used to discover accounts.
- **SSO (OIDC)** uses the authorization-code flow with PKCE. ID tokens are verified against the provider's JWKS (issuer and audience). Accounts must already exist (no just-in-time provisioning). The access token handed to the SPA travels in the URL fragment and is valid for 60 seconds.
- **Guest mode** signs a visitor in to a private sandbox organisation. Sandbox users have no usable password, so password login is impossible for them. Turn it off with `GUEST_MODE_ENABLED=false`.

## CSRF

The API authenticates with a bearer token, which a cross-site page cannot attach. The only cookie-authenticated endpoints are `/auth/refresh` and `/auth/logout`. They require the custom header `X-Requested-With: SpaceFlow` (which forces a CORS preflight), and the cookie is `SameSite=Strict` and path-scoped.

## Authorization (RBAC)

Every protected route checks the token and the required permission on the server; the UI hiding a button is never the control. Resource queries are additionally scoped to the caller's `orgId`. Employees can only read or modify their own reservations unless they have `reservation:manage-any` or `reservation:approve`. Department and team restrictions are enforced by the booking engine.

Permissions per role (from `packages/shared/src/enums.ts` → `ROLE_PERMISSIONS`; the same map is seeded into the `role_permissions` table):

| Permission | Employee | Approver | Workplace admin | Org admin |
| --- | :-: | :-: | :-: | :-: |
| `workplace:read` | ✓ | ✓ | ✓ | ✓ |
| `reservation:create` | ✓ | ✓ | ✓ | ✓ |
| `reservation:manage-own` | ✓ | ✓ | ✓ | ✓ |
| `user:read` | ✓ | ✓ | ✓ | ✓ |
| `reservation:approve` |  | ✓ | ✓ | ✓ |
| `reservation:manage-any` |  |  | ✓ | ✓ |
| `resource:manage` |  |  | ✓ | ✓ |
| `building:manage` |  |  | ✓ | ✓ |
| `floorplan:manage` |  |  | ✓ | ✓ |
| `policy:manage` |  |  | ✓ | ✓ |
| `analytics:read` |  |  | ✓ | ✓ |
| `audit:read` |  |  | ✓ | ✓ |
| `user:manage` |  |  |  | ✓ |
| `integration:manage` |  |  |  | ✓ |
| `settings:manage` |  |  |  | ✓ |

Additional rules:

- Only holders of `settings:manage` (org admins) can grant `WORKPLACE_ADMIN` or `ORG_ADMIN`.
- The last active org admin cannot be demoted.
- Users cannot deactivate or delete themselves.
- Approvers cannot approve their own requests.
- Admins acting on behalf of others are audited, and cancelling someone else's booking requires a reason.

## CORS

- **Production:** only origins listed in `WEB_ORIGIN` (comma-separated, exact match) are allowed, with credentials.
- **Development and test:** `WEB_ORIGIN` plus any `http(s)://localhost`, `127.0.0.1` or `[::1]` origin on any port, because Vite moves to 5174 and up when 5173 is busy.
- A disallowed origin gets **403** with an explanatory message. Requests without an `Origin` header (curl, server-to-server) are not affected by CORS.
- In the recommended deployment, the SPA and API share one origin (nginx proxies `/api`), so the browser never makes cross-origin calls.

## Rate limiting

These limits are per client IP and in-memory per API instance; `trust proxy` is enabled for one hop. Exceeding one returns `429` with `RATE_LIMITED`.

| Scope | Limit |
| --- | --- |
| Login, refresh, forgot and reset password, accept invite, guest | 20 per 15 minutes |
| Reservation create and modify | 120 per minute |
| Whole API | 600 per minute |

Limits are disabled when `NODE_ENV=test`.

## Input validation

Every body, query and path parameter is validated with Zod schemas shared with the web app. Unknown or invalid input is rejected with 400 `VALIDATION_ERROR` and per-field issues. Database access goes through Prisma (parameterized). The few raw SQL statements use tagged templates or fixed identifiers, never user input.

## File uploads

These rules apply to `POST /assets` (requires `floorplan:manage`):

- **Allow-list per kind:** `.glb` for building and floor models; `.png`, `.jpg`/`.jpeg` and `.svg` for floor-plan images.
- **Content sniffing:** the GLB magic `glTF`, PNG and JPEG signatures, and a root `<svg>` element are checked. SVGs containing `<script>`, `on*=` handlers, `javascript:` URLs, `foreignObject`, iframes or external `xlink:href` are rejected (415).
- **Size limit:** `MAX_UPLOAD_MB` (default 25 MB), returning 413. One file per request; empty files are rejected.
- **Storage:** files are stored under a server-generated name (a hash plus a timestamp). The original name is only sanitized metadata, and path traversal is blocked.
- **Serving:** files are served with their sniffed content type plus `X-Content-Type-Options: nosniff` and a restrictive `Content-Security-Policy`. Uploaded files are never executed. CSV imports are parsed as data with a 5 MB and 2,000-row limit, and every row is validated before any write.

## Audit log

The following actions write an `audit_logs` row with actor, action, entity, before and after values, IP address and time:

- sign-in, logout, SSO and guest sign-in, password reset and change, invite acceptance;
- reservation create, update, cancel, admin cancel, check-in, check-out, auto-release, approval decision and export;
- admin changes: building create, update, model and archive; floor create, update and delete; floor plan save, publish and unpublish; resource create, update, archive, bulk update and CSV import; maintenance windows; asset upload and delete; user create, update, invite and delete; policy create, update and delete; announcement creation and deletion; floor reordering; zone create, update and delete; integration and organisation settings updates.

Floor reordering, zone create, update and delete, and announcement deletion are audited too.

Sensitive fields (password and token hashes, check-in codes) are redacted before storage. Admins with `audit:read` can browse the log in the admin portal. Users can see their own sign-in activity on the settings page.

## Secrets

- Secrets come only from environment variables or a secret manager; `.env` files are git-ignored. In production the API refuses to start with placeholder JWT secrets.
- No secret is exposed to the browser bundle, since only `VITE_*` variables are embedded and none are secret.
- Integration settings saved through the admin UI drop keys that look like secrets (`secret`, `password`, `token`, `key`); credentials stay in the environment.

## Transport and headers

TLS terminates in front of the web container. nginx sends HSTS, a CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy and Permissions-Policy. The API also sets Helmet defaults, with its CSP enabled in production.

## Reporting

Report suspected vulnerabilities privately to the maintainers rather than in a public issue.
