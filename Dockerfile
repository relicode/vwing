# syntax=docker/dockerfile:1
ARG BUN_VERSION=1.3.13

# ── deps: install dependencies once, cached on the lockfile ───────────────────
FROM oven/bun:${BUN_VERSION}-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

# ── build: bundle the React/Pixi client into /app/dist ───────────────────────
FROM deps AS build
COPY . .
RUN bun run build

# ── runtime: the Bun server serves ./dist + the lobby/WebSocket on $PORT ──────
# The server only touches Bun builtins + ./src (resolved through the tsconfig
# "$/*" alias) + the built ./dist — pixi/react/mui are client-only and bundled
# into dist — so no node_modules ships in the final image.
FROM oven/bun:${BUN_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY --from=build /app/dist ./dist
EXPOSE 8787
USER bun
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["bun", "--eval", "fetch(`http://127.0.0.1:${process.env.PORT||8787}/api/health`).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "run", "scripts/server.ts"]
