# syntax=docker/dockerfile:1
# Production image for the composed authoritative multiplayer server.
# Build context is the repository root (see docker-compose.yml / build docs):
#   docker build -f packages/server-runtime/Dockerfile -t assalto-multiplayer .

# ---------------------------------------------------------------------------
# Build stage: install toolchains, compile every package's dist, then prune to
# production dependencies. This whole stage is discarded from the final image.
# ---------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /repo
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# game-core is compiled with the web package's TypeScript (per the package
# scripts); install only its toolchain, skipping browser downloads.
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci --ignore-scripts

# Backend packages: install dev toolchains and build the full dist chain.
COPY packages ./packages
RUN npm --prefix packages/multiplayer-protocol ci \
 && npm --prefix packages/authoritative-server ci \
 && npm --prefix packages/server-transport ci \
 && npm --prefix packages/server-runtime ci
RUN npm --prefix packages/server-runtime run build

# Prune each package to production dependencies (keeps pg/ws; drops toolchains).
RUN npm --prefix packages/authoritative-server ci --omit=dev \
 && npm --prefix packages/server-transport ci --omit=dev \
 && npm --prefix packages/server-runtime ci --omit=dev

# ---------------------------------------------------------------------------
# Runtime stage: a small image with only built dist and production node_modules,
# running as a non-root user. The packages/ layout is preserved so the file:
# workspace links resolve.
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
WORKDIR /app/packages/server-runtime

# game-core and multiplayer-protocol have no runtime dependencies (dist only).
COPY --from=build /repo/packages/game-core/package.json /app/packages/game-core/package.json
COPY --from=build /repo/packages/game-core/dist /app/packages/game-core/dist
COPY --from=build /repo/packages/multiplayer-protocol/package.json /app/packages/multiplayer-protocol/package.json
COPY --from=build /repo/packages/multiplayer-protocol/dist /app/packages/multiplayer-protocol/dist

COPY --from=build /repo/packages/authoritative-server/package.json /app/packages/authoritative-server/package.json
COPY --from=build /repo/packages/authoritative-server/dist /app/packages/authoritative-server/dist
COPY --from=build /repo/packages/authoritative-server/node_modules /app/packages/authoritative-server/node_modules

COPY --from=build /repo/packages/server-transport/package.json /app/packages/server-transport/package.json
COPY --from=build /repo/packages/server-transport/dist /app/packages/server-transport/dist
COPY --from=build /repo/packages/server-transport/node_modules /app/packages/server-transport/node_modules

COPY --from=build /repo/packages/server-runtime/package.json /app/packages/server-runtime/package.json
COPY --from=build /repo/packages/server-runtime/dist /app/packages/server-runtime/dist
COPY --from=build /repo/packages/server-runtime/node_modules /app/packages/server-runtime/node_modules

USER node
EXPOSE 8080

# Readiness includes the database check; a failing DB turns the container unready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/readyz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
