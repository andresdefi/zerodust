# ZeroDust MCP server — stdio transport.
#
# Runs read-only by default. To enable sweeping, pass:
#   -e ZERODUST_ALLOW_EXECUTE=true -e ZERODUST_PRIVATE_KEY=0x...
# and optionally -e ZERODUST_ALLOWED_DESTINATIONS=0x...,0x...
#
# Glama introspects the server by starting it and issuing an MCP
# initialize/tools-list handshake over stdio, which works without any of the
# execute env vars.

FROM node:20-alpine AS build
WORKDIR /app

# Install deps against the lockfile first for cacheable layers.
COPY package.json package-lock.json* ./
RUN npm ci

# Build TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies for the runtime image.
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Run as the built-in non-root user.
USER node

# stdio transport — the MCP client speaks JSON-RPC over stdin/stdout.
ENTRYPOINT ["node", "dist/index.js"]
