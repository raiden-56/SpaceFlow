# syntax=docker/dockerfile:1.7
# SpaceFlow web image: builds the Vite SPA and serves it with nginx, proxying /api to the API.
# Build from the repository root:  docker build -f infrastructure/docker/web.Dockerfile -t spaceflow-web .

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "@spaceflow/web..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Empty = same origin: nginx proxies /api, which keeps the refresh cookie first-party.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @spaceflow/web build

FROM nginx:1.27-alpine AS runtime
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
