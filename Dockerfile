FROM node:22-slim AS base
WORKDIR /app
# build tools for better-sqlite3 native module (used when prebuilds don't match)
# — throwaway stages only; the shipped images start from plain node:22-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# production-only node_modules for the runtime stages: devDependencies
# (vitest, playwright-core, drizzle-kit, typescript) never reach the shipped
# images. tsx is a real dependency — the worker/mcp entrypoints run through it.
FROM base AS deps-prod
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next build sets NODE_ENV=production; config requires SESSION_SECRET then
ENV SESSION_SECRET=build-time-placeholder
ENV DATABASE_PATH=/tmp/radar-build.db
RUN npm run build

# --- web: Next.js standalone server ---
FROM node:22-slim AS web
WORKDIR /app
ENV NODE_ENV=production
# chown so the node user can write the runtime .next/cache; node_modules in the
# standalone output stays readable-only. /data (SQLite) is a mounted volume —
# see docker-compose.yml for host ownership notes.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# WORKDIR itself stays root-owned after COPY; hand it to node for cache writes
RUN chown node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# --- worker: cron jobs via tsx (also the mcp image; compose overrides CMD) ---
FROM node:22-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps-prod /app/node_modules ./node_modules
# chown the source tree for the node user; node_modules stays root-owned/read-only
COPY --chown=node:node . .
# WORKDIR itself stays root-owned after COPY; hand it to node so it can create
# top-level artifacts (default TRANSFORMERS_CACHE=.hfcache lives under it)
RUN chown node:node /app
USER node
CMD ["npx", "tsx", "worker/index.ts"]
