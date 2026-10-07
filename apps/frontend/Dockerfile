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
