# Deployment

## Artifacts

| Component | Build | Runtime |
| --- | --- | --- |
| API | `pnpm --filter @spaceflow/api build`: `prisma generate`, then `tsc --noEmit`, then an esbuild bundle at `apps/api/dist/server.js` | `node dist/server.js` with production `node_modules` (npm packages stay external) |
| Web | `pnpm --filter @spaceflow/web build`: static files in `apps/web/dist` | Any static web server; nginx config in `infrastructure/docker/nginx.conf` |
| Images | `infrastructure/docker/api.Dockerfile`, `infrastructure/docker/web.Dockerfile` | Published to GHCR by `.github/workflows/release.yml` on `v*.*.*` tags |

**Why the API is bundled.** The shared workspace package ships TypeScript source, which Node cannot execute. esbuild inlines workspace code into one ESM file and leaves npm dependencies external. Type checking still runs as a separate `tsc --noEmit` step.

## Docker images

```bash
docker build -f infrastructure/docker/api.Dockerfile -t spaceflow-api .
docker build -f infrastructure/docker/web.Dockerfile -t spaceflow-web .
```

- **API image:** multi-stage (pnpm, Prisma generate, bundle, `pnpm deploy --prod`), runs as the non-root `node` user under `tini`, and has a `HEALTHCHECK` on `/api/v1/health`. The entrypoint runs `prisma migrate deploy` and then starts the server; set `RUN_MIGRATIONS=false` when a separate release job runs migrations.
- **Web image:** nginx serves the SPA with history fallback and proxies `/api/` to `api:4000` (SSE without buffering, one-hour read timeout). It sets security headers (CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy and Permissions-Policy), gzip, immutable caching for `/assets/`, and `no-cache` for `index.html`. Its health endpoint is `/healthz`.
- **Build argument:** `VITE_API_URL` (default empty, meaning same origin). Keep it empty when nginx proxies `/api`, so the refresh cookie stays first-party.

### Compose

`docker compose --profile full up -d --build` starts PostgreSQL, the API (production mode) and the web container. It requires `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. Host ports come from `API_HOST_PORT` (default 4000) and `WEB_PORT` (default 8080); the README example uses 4001 and 8081 to avoid a running dev server. Uploads persist in the `spaceflow-uploads` volume, and the database in `spaceflow-pgdata`.

## Production configuration

Required:

- `NODE_ENV=production`
- `DATABASE_URL`: a role that owns the schema. The first migration runs `CREATE EXTENSION IF NOT EXISTS btree_gist` (a trusted extension on PostgreSQL 13 and later); on managed services, enable it beforehand if the role cannot create extensions.
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`: independent random values of 48 bytes or more. The API refuses to start with the `change-me` placeholders.
- `WEB_ORIGIN`: the exact public origin or origins of the web app (comma-separated). In production, CORS allows only these.
- `API_BASE_URL`: the public origin under which `/api` is reachable (used in asset URLs).
- `UPLOAD_DIR` on persistent storage, mounted at the same path on every instance.

Recommended:

- Terminate TLS at the load balancer or ingress and redirect HTTP to HTTPS. Cookies are `Secure` in production, and nginx sends HSTS.
- Set `SENTRY_DSN` for error reporting and `LOG_LEVEL=info`.
- Disable guest mode on internal production deployments with `GUEST_MODE_ENABLED=false`, unless public demos are intended.
- Configure SMTP and SSO as needed (see [integrations.md](integrations.md)).
- Do not set the `SEED_*` variables. Never run the seed in production; it refuses unless `SEED_ALLOW_PROD=true`.

Store secrets in the platform's secret manager (Kubernetes Secrets, AWS Secrets Manager, Azure Key Vault and so on), not in images or the repository. Only `VITE_*` variables reach the browser bundle, and none of them are secret.

## Release procedure

1. Merge to `main` with CI green: typecheck, API unit and integration tests, web tests and build, API bundle, E2E, and Docker build.
2. Tag `vX.Y.Z` and push. The release workflow publishes `ghcr.io/<owner>/spaceflow-api` and `spaceflow-web` for `amd64` and `arm64`.
3. Take a database backup ([operations.md](operations.md#backup-and-recovery)).
4. Deploy the API. Migrations run on start, or run `npx prisma migrate deploy` from a release job with `RUN_MIGRATIONS=false` on the app containers.
5. Deploy the web image.
6. Verify `/api/v1/health` returns `status: ok`, then sign in and open a floor map.

Migrations are forward-only, so roll back by redeploying the previous images. If a migration must be undone, restore the pre-release backup.

## Scaling

- The API is stateless apart from three things:
  - **The SSE client list** is per process, so events reach only clients connected to the instance that handled the change. With several replicas, either enable sticky sessions for `/api/v1/events` and accept that other replicas' changes arrive on the next refetch, or add a Redis pub/sub fan-out. `REDIS_URL` is reserved for this and is not implemented yet.
  - **The SSO login state** (PKCE verifier) is held in memory, so use sticky sessions for `/api/v1/auth/sso/*` or move it to Redis.
  - **Uploads** live on local disk, so use a shared volume or replace `modules/assets/service.ts` with an object-storage adapter.
- Background jobs are safe with any number of replicas thanks to the PostgreSQL advisory lock.
- The rate limiter is in-memory per instance, so limits are effectively per replica.
- For PostgreSQL, the indexes cover the hot paths (availability by resource and time, user reservations, org and status, audit by org and time). Use a connection pooler such as PgBouncer in transaction mode with Prisma's `pgbouncer=true` when running many replicas.
