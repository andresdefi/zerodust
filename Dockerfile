# ZeroDust MCP server - stdio transport.
#
# This Dockerfile lives at the repo root because indexers (Glama and friends)
# build with the repository root as the context. The server itself lives in
# packages/mcp-server, so every COPY below is repo-root relative.
#
# Runs read-only by default. To enable sweeping, pass:
#   -e ZERODUST_ALLOW_EXECUTE=true -e ZERODUST_PRIVATE_KEY=0x...
# and optionally -e ZERODUST_ALLOWED_DESTINATIONS=0x...,0x...
#
# Introspection (MCP initialize + tools/list over stdio) works without any of
# the execute env vars.

FROM node:20-alpine AS build
WORKDIR /app

# Install deps against the lockfile first for cacheable layers.
COPY packages/mcp-server/package.json packages/mcp-server/package-lock.json ./
RUN npm ci

# Build TypeScript -> dist/
COPY packages/mcp-server/tsconfig.json ./
COPY packages/mcp-server/src ./src
RUN npm run build

# Drop dev dependencies for the runtime image.
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY packages/mcp-server/package.json ./

# Run as the built-in non-root user.
USER node

# stdio transport - the MCP client speaks JSON-RPC over stdin/stdout.
ENTRYPOINT ["node", "dist/index.js"]
