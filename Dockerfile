# syntax=docker/dockerfile:1

# ---- build: install everything, build the packages -------------------------
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

# Manifests first, so the dependency layer is reused while only source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/monitor/package.json apps/monitor/
COPY apps/control/package.json apps/control/
COPY server/package.json server/
COPY sensor/package.json sensor/
COPY packages/protocol/package.json packages/protocol/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Production dependencies of the server only (sirv, ws, zod). @app/protocol is
# bundled into server/dist, so no workspace package is needed at runtime.
RUN pnpm --filter @app/server deploy --prod --legacy /out

# ---- runtime: Node, the server and sensor bundles, the two built apps -------
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app/server

# Files stay owned by root; the server runs as "node" and can only read them.
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/server/dist ./dist
# The server finds the apps at ../../apps from dist/index.js (STATIC_DIR default).
COPY --from=build /repo/apps/monitor/dist /app/apps/monitor/dist
COPY --from=build /repo/apps/control/dist /app/apps/control/dist
# The sensor agent: one file with its dependencies bundled. The same image runs
# it as a second container: node /app/sensor/dist/index.js (docker-compose.yml).
COPY --from=build /repo/sensor/dist /app/sensor/dist
# The SQLite database (DATABASE_PATH default: /app/data/threshold-monitor.db).
# The only folder the server writes to; mount a volume here to keep the data.
RUN mkdir /app/data && chown node:node /app/data
VOLUME /app/data

USER node
EXPOSE 8080
# No curl or wget needed: Node 24 has fetch. PORT may be changed at run time.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Node is PID 1 and handles SIGTERM itself: a graceful shutdown with 1001 to every client.
CMD ["node", "dist/index.js"]
