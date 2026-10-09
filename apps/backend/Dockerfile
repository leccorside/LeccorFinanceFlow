# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).

FROM node:24-alpine AS base
ENV CI=true
# openssl: required by the Prisma schema engine (migrations) on Alpine.
RUN apk add --no-cache openssl \
  && corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app

# Dependencies change less often than source: keep them in their own layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/contracts/package.json packages/contracts/
# The backend postinstall runs `prisma generate`, which needs the schema and config.
COPY apps/backend/prisma.config.ts apps/backend/
COPY apps/backend/prisma apps/backend/prisma
RUN pnpm install --frozen-lockfile --filter "leccor-finance-flow" --filter "@leccor/backend..."

FROM deps AS development
ENV NODE_ENV=development
# .env.example has no secrets; a unit test checks it boots the backend as-is.
COPY tsconfig.base.json .env.example ./
# Owned by `node` so `docker compose watch` can sync files into the container.
COPY --chown=node:node apps/backend apps/backend
RUN chown -R node:node apps/backend/src/generated \
  && chown node:node apps/backend apps/backend/node_modules
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@leccor/backend", "dev"]

# ─────────────────────────── Production (docker-compose.prod.yml) ───────────────────────────

# Compiles TypeScript (including the generated Prisma Client) to dist/.
FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/backend apps/backend
RUN pnpm --filter @leccor/backend build

# Runtime dependencies only. Scripts are skipped: the Prisma Client is already compiled
# into dist/generated, and the Prisma CLI (a dev dependency) is not needed to serve.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@leccor/backend..."

# One-shot job: applies migrations and the idempotent seed, then exits.
# Has the Prisma CLI and tsx; never serves traffic.
FROM deps AS migrate
COPY tsconfig.base.json ./
COPY apps/backend apps/backend
USER node
CMD ["sh", "-c", "pnpm --filter @leccor/backend db:deploy && pnpm --filter @leccor/backend db:seed"]

# The API: compiled code + runtime dependencies, as the unprivileged `node` user.
FROM node:24-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY apps/backend/package.json ./apps/backend/
# Report files live here until they expire; private to the process user.
RUN mkdir -p /tmp/leccor-finance-flow/reports && chown -R node:node /tmp/leccor-finance-flow
USER node
WORKDIR /app/apps/backend
EXPOSE 3000
CMD ["node", "dist/main.js"]
