# Build from the monorepo root:  docker build -f apps/api/Dockerfile .  (make docker-api)
# Smoke-test the image:          make docker-agent-smoke
#
# Three stages (plan 11.5): the static Go API, the agent runtime staged by the
# same script the desktop app uses (apps/web/electron/stage-agent.mjs, plan
# 11.4), and a Debian slim runtime that holds both. Debian, not Alpine: the
# runtime's interpreter and wheels are built for glibc.

# Every stage that contributes a shipped file is pinned by digest (scripts/stage-agent.test.mjs
# checks it). Move this pin with the go.mod toolchain: GOTOOLCHAIN=local cannot fetch a newer Go.
FROM golang:1.25.14-alpine@sha256:1ae0735f00daffa3aaf1363a5184c0d2dc55c78e3db4ec70241cdac97bf84b59 AS builder

WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o /out/timely-api ./cmd

# ---------------------------------------------------------------- agent runtime
# stage-agent.mjs uses only node: builtins, uv and tar. It needs the Makefile
# (AGENT_PYTHON_VERSION), apps/agent and its own three files at their repo
# paths. It stages the build platform's own target only, so TARGETARCH picks
# the key: amd64 is linux-x64, arm64 is linux-arm64 (not built by any release).
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS agent

COPY --from=ghcr.io/astral-sh/uv:0.13.6@sha256:af22a52f5eafef3d78e551599d405c02df61919d18028f0cea8eda93bc9986d0 /uv /usr/local/bin/uv

WORKDIR /src
COPY Makefile ./
COPY apps/agent apps/agent
COPY apps/web/electron/stage-agent.mjs apps/web/electron/stage-agent-lib.mjs apps/web/electron/targets.mjs apps/web/electron/

ARG TARGETARCH
# The caches hold the interpreter download (sha256-checked against
# pm/lock.json) and uv's wheels; the staged tree itself is rebuilt each time.
# A Linux target's stage folder (its stageDir) is named after its key.
RUN --mount=type=cache,id=timely-agent-python,target=/src/apps/web/.cache/agent \
    --mount=type=cache,id=timely-agent-uv,target=/root/.cache/uv \
    set -eu; \
    case "${TARGETARCH:-}" in \
      amd64) key=linux-x64 ;; \
      arm64) key=linux-arm64 ;; \
      *) echo "TARGETARCH '${TARGETARCH:-}' has no agent runtime target (amd64 or arm64)" >&2; exit 1 ;; \
    esac; \
    TIMELY_TARGETS="$key" node apps/web/electron/stage-agent.mjs --target "$key"; \
    mkdir -p /out; \
    mv "apps/web/.electron-agent/$key" /out/agent; \
    test -f /out/agent/MANIFEST.json

# ---------------------------------------------------------------- runtime
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc

# The worker resolves the account's time zone with Python's zoneinfo, which
# reads /usr/share/zoneinfo on Linux (uv.lock's tzdata wheel is Windows-only);
# the base image's tzdata package provides it (make docker-agent-smoke checks).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 timely \
  && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /data --shell /usr/sbin/nologin timely \
  && mkdir -p /data && chown timely:timely /data

WORKDIR /app
# Owned by root, so the runtime is read-only to timely (plan 11.4: the
# packaged runtime is never written; bytecode was compiled when staging).
COPY --from=agent /out/agent /app/agent
# Migrations are embedded in the binary.
COPY --from=builder /out/timely-api /app/timely-api
USER timely

# Containers must listen on every interface; the default is loopback only.
# Agent state (homes, seed tree, Timely skills copy) goes to /data/agent, on the
# same volume as the rest of the API's data. Terminal and file tools act inside
# this container (plan 11.5; ADR 0026 does not say this yet).
ENV API_BIND=0.0.0.0 \
    TIMELY_DATA_DIR=/data \
    TIMELY_AGENT_RUNTIME=/app/agent
EXPOSE 8080
CMD ["/app/timely-api"]
