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
