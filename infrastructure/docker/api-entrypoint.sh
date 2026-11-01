#!/bin/sh
# Applies pending database migrations, then starts the API.
# Set RUN_MIGRATIONS=false when migrations are run by a separate release job.
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations…"
  npx prisma migrate deploy
fi
exec node dist/server.js
