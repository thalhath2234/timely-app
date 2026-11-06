# Build from the monorepo root:  docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS builder

WORKDIR /repo
RUN corepack enable

# Install only what @timely/web needs, plus the workspace packages it imports,
# using the root lockfile. pnpm reads every patch the workspace lists.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
RUN pnpm install --frozen-lockfile --filter "@timely/web..."

COPY packages/contract packages/contract
COPY apps/web apps/web
RUN pnpm --filter @timely/web build

FROM node:22-alpine

WORKDIR /repo
COPY --from=builder --chown=node:node /repo .
USER node

# API_ORIGIN (where /api-proxy/* goes) is read when the server starts, so
# set it at run time, as docker-compose.yml does. Next runs directly: through
# pnpm, corepack would download pnpm again on every start.
WORKDIR /repo/apps/web
EXPOSE 4001
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "4001"]
