FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY --from=builder /app .

EXPOSE 3000

CMD ["pnpm", "start"]
