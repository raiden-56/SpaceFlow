# syntax=docker/dockerfile:1.7
# SpaceFlow API image: builds the bundled API (esbuild) and ships production dependencies only.
# Build from the repository root:  docker build -f infrastructure/docker/api.Dockerfile -t spaceflow-api .

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
# openssl: required by the Prisma query engine on Alpine.
RUN apk add --no-cache openssl libc6-compat
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app

# --- dependencies (cached while manifests are unchanged) -------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "@spaceflow/api..."

# --- build -------------------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @spaceflow/api build
# Self-contained production install of the API package (no workspace symlinks, no dev deps).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @spaceflow/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma \
 && cd /out && npx prisma generate

# --- runtime -----------------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
RUN apk add --no-cache openssl libc6-compat tini
ENV NODE_ENV=production API_PORT=4000 UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --chown=node:node infrastructure/docker/api-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${API_PORT}/api/v1/health" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
