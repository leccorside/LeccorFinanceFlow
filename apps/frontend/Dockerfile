# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).

FROM node:24-alpine AS base
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app

# Dependencies change less often than source: keep them in their own layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter "leccor-finance-flow" --filter "@leccor/frontend..."

FROM deps AS development
ENV NODE_ENV=development
COPY tsconfig.base.json ./
# Owned by `node` so `docker compose watch` can sync files and Vite can write its cache.
COPY --chown=node:node apps/frontend apps/frontend
RUN chown node:node apps/frontend apps/frontend/node_modules
USER node
EXPOSE 5173
CMD ["pnpm", "--filter", "@leccor/frontend", "dev"]

# ─────────────────────────── Production (docker-compose.prod.yml) ───────────────────────────

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/frontend apps/frontend
RUN pnpm --filter @leccor/frontend build

# Static files + /api reverse proxy. Unprivileged image: listens on 8080 as a non-root user.
# The security headers (CSP…) are the same as apps/frontend/security-headers.ts; a unit test
# keeps nginx/security-headers.conf in sync with it.
FROM nginxinc/nginx-unprivileged:1.28-alpine AS production
COPY apps/frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY apps/frontend/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
