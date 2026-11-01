# Operations

## Health checks

| Endpoint | Meaning |
| --- | --- |
| `GET /api/v1/health` | Returns 200 `{"status":"ok","version","uptimeSeconds","checks":{"database":"ok","jobs":"ok"\|"disabled"\|"error"}}`, or 503 with `"status":"degraded"` when the database is unreachable. `/health` redirects here. |
| `GET /healthz` (web container) | nginx liveness check |

Both Docker images define `HEALTHCHECK`s. Use `/api/v1/health` as the readiness probe and a TCP check or `/api/v1/health` as the liveness probe.

## Logs

- Logs are structured JSON from pino (pretty-printed in development). Each request gets an `X-Request-Id`, which is echoed in the response header, error bodies (`error.requestId`) and every log line, so a user's error can be traced to its log entry.
- Redacted: `Authorization` and `Cookie` headers, `Set-Cookie`, and any `password`, `token`, `accessToken` or `refreshToken` field. Request logs include method, URL and status only; bodies are never logged.
- The level is set by `LOG_LEVEL` (`info` by default). In tests, logs are silent.
- Health-check requests are not logged.

## Error monitoring

Set `SENTRY_DSN` to a Sentry-compatible DSN. Unhandled API errors (500s, unhandled rejections and uncaught exceptions) are sent to the store endpoint with the request ID and path, through `lib/monitoring.ts`, with no SDK dependency. Without a DSN, nothing leaves the process. Expected errors (4xx such as validation, conflicts and policy violations) are not reported.

On the web, an app-level error boundary shows a recovery screen instead of a blank page, and the error is logged to the browser console.

## Background jobs

The scheduler runs inside the API every `JOBS_INTERVAL_SECONDS` (default 30 s). Set `JOBS_ENABLED=false` to turn it off on some instances, for example if a dedicated worker instance should run the jobs.

- **Single runner:** each tick calls `pg_try_advisory_lock(7361902)`. Ticks on other instances are skipped while one runs, and the lock is released in `finally`.
- **History:** each tick writes a `job_runs` row (`RUNNING`, `SUCCESS` or `FAILED`, with counts or the error). Rows older than three days are pruned. The `jobs` field of the health check reports `error` if the last tick on that instance failed.
- **Work per tick:** booking reminders, check-in reminders and no-show warnings, no-show auto-release, completion of ended bookings, refresh-token cleanup, and guest sandbox purge.

Recent runs:

```sql
SELECT name, status, started_at, finished_at, details FROM job_runs ORDER BY started_at DESC LIMIT 20;
```

## Guest sandbox purge

Each guest session creates an organisation with slug `guest-<id>` (about 200 desks, 250 reservations and their users). The scheduler deletes sandboxes older than `GUEST_SANDBOX_TTL_HOURS` (default 24), at most 20 per tick, along with all their rows. To purge manually:

```sql
-- How many sandboxes exist and how old they are
SELECT count(*), min(created_at), max(created_at) FROM organizations WHERE slug LIKE 'guest-%';
```

Lowering `GUEST_SANDBOX_TTL_HOURS` and restarting makes the next ticks remove more. Disable guest mode with `GUEST_MODE_ENABLED=false`; existing sandboxes are still purged.

## Backup and recovery

PostgreSQL is the only stateful store besides the uploads directory. Back up both.

### Database backups

Take a nightly logical backup in custom format, which is compressed and supports parallel and selective restore:

```bash
pg_dump --format=custom --no-owner --no-privileges \
  --file="spaceflow-$(date +%Y%m%d-%H%M).dump" "$DATABASE_URL"
```

With the local Docker database:

```bash
docker exec spaceflow-db pg_dump -U spaceflow -d spaceflow --format=custom > spaceflow-$(date +%Y%m%d).dump
```

Recommendations:

- Keep 7 daily, 4 weekly and 12 monthly backups in storage outside the database host, encrypted at rest.
- For point-in-time recovery, also enable WAL archiving (managed services: turn on PITR) and keep a recovery window of at least 7 days.
- Back up the uploads volume (`UPLOAD_DIR`, or the `spaceflow-uploads` Docker volume) on the same schedule, for example with `tar czf uploads-$(date +%Y%m%d).tgz -C "$UPLOAD_DIR" .`.

### Restore

```bash
# 1. Stop the API (or scale it to 0) so no writes happen during the restore.
# 2. Restore into an empty database (create it first if needed):
createdb -h <host> -U <owner> spaceflow_restore
psql -h <host> -U <owner> -d spaceflow_restore -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
pg_restore --no-owner --no-privileges --jobs=4 -h <host> -U <owner> -d spaceflow_restore spaceflow-YYYYMMDD-HHMM.dump
# 3. Point DATABASE_URL at the restored database (or rename databases), restore the uploads
#    directory, then start the API. `prisma migrate deploy` applies any newer migrations.
```

### Restore drill (quarterly)

1. Restore the latest backup into a scratch database, as above.
2. Check that the schema and constraint survived:
   ```sql
   SELECT conname FROM pg_constraint WHERE conname IN ('reservations_no_overlap', 'reservations_valid_range');
   SELECT count(*) FROM reservations; SELECT max(created_at) FROM reservations;
   ```
3. Start an API instance against it with `JOBS_ENABLED=false` and a spare port, then check `/api/v1/health`, sign in and open a floor map.
4. Record the time taken (your RTO) and the age of the newest row (your RPO), then drop the scratch database.

## Routine maintenance

- **Token table:** the scheduler removes expired refresh tokens and revoked ones older than 7 days.
- **Audit log:** append-only and indexed by org and time. Archive entries older than your retention policy with `COPY (SELECT ...) TO ...` and then `DELETE`, if required.
- **Migrations:** `pnpm db:migrate` (`prisma migrate deploy`) is idempotent.
- **Disk:** uploads are bounded by `MAX_UPLOAD_MB` per file. Deleting an asset in the admin portal removes its file.
