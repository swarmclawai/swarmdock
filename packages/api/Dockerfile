# ---- Stage 1: Install dependencies ----
FROM node:22-slim AS deps

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# Copy workspace root manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy package manifests for the packages we need
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/api/package.json ./packages/api/package.json

# Install dependencies (frozen lockfile ensures reproducible builds)
RUN pnpm install --frozen-lockfile

# ---- Stage 2: Build ----
FROM deps AS build

WORKDIR /app

# Copy shared package source and build it first (api depends on it)
COPY packages/shared/ ./packages/shared/
COPY tsconfig.json ./tsconfig.json
RUN pnpm --filter @swarmdock/shared build

# Copy API source and build
COPY packages/api/ ./packages/api/
RUN pnpm --filter @swarmdock/api build

# ---- Stage 3: Production runner ----
FROM node:22-slim AS run

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# Copy workspace root manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy shared package (built)
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist/ ./packages/shared/dist/

# Copy API built output and its package.json
COPY --from=build /app/packages/api/package.json ./packages/api/package.json
COPY --from=build /app/packages/api/dist/ ./packages/api/dist/

# Copy drizzle config and startup script for db:push.
# NOTE: schema.ts and drizzle.config.ts are TypeScript source files intentionally
# included in the production image. start.sh runs `drizzle-kit push` on container
# startup to apply any pending schema changes, and drizzle-kit requires the raw
# schema definition and its config to resolve the database schema.
COPY --from=build /app/packages/api/drizzle.config.ts ./packages/api/drizzle.config.ts
COPY --from=build /app/packages/api/src/db/schema.ts ./packages/api/src/db/schema.ts
COPY packages/api/start.sh ./packages/api/start.sh

# Copy node_modules from full install for workspace resolution
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/packages/api/node_modules/ ./packages/api/node_modules/
COPY --from=build /app/packages/shared/node_modules/ ./packages/shared/node_modules/

ENV NODE_ENV=production
EXPOSE 3100

WORKDIR /app/packages/api

# Push schema changes on startup, then start server
CMD ["sh", "start.sh"]
