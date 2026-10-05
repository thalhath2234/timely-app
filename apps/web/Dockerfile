# Build from the monorepo root:  docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS builder

WORKDIR /repo
RUN corepack enable

# Install only what @timely/web needs, using the root lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @timely/web

COPY apps/web apps/web
RUN pnpm --filter @timely/web build

FROM node:22-alpine

WORKDIR /repo
RUN corepack enable

COPY --from=builder --chown=node:node /repo .
USER node

EXPOSE 4001
CMD ["pnpm", "--filter", "@timely/web", "start"]
