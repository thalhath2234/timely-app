#!/usr/bin/env bash
# Smoke-test the API Docker image with its agent runtime (plan 11.5; phase 3b
# work packages "docker"). Run it from the repo root through the Makefile:
#
#   make docker-agent-smoke
#
# It builds timely-api:<run id> for linux/amd64 from apps/api/Dockerfile (a tag
# of its own, so runs from two worktrees never remove each other's image),
# then checks, all inside that image:
#
#   0. the image: user timely (10001), TIMELY_AGENT_RUNTIME=/app/agent,
#      TIMELY_DATA_DIR=/data, API_BIND=0.0.0.0; /app/agent owned by root with
#      nothing in it timely can write, even without --read-only; /data owned by
#      timely; zoneinfo resolves an IANA zone (tzdata);
#   1. as uid 10001 with --read-only, --tmpfs /tmp and a throwaway /data volume,
#      `python3 -I /app/agent/boot.py prepare --agent-dir /data/agent` exits 0
#      and answers ok;
#   2. the Go agenthost test binary (CGO_ENABLED=0, built on this host) mounted
#      read-only runs TestIntegrationRealWorker as uid 10001 with --read-only
#      and TIMELY_AGENT_TEST_RUNTIME=/app/agent: the real worker reaches ready
#      and finishes a run on the test's stub model on 127.0.0.1;
#   3. a throwaway postgres:17 and the API on a private network, the API
#      published only on a loopback port Docker picks (never 8080): /health
#      answers, the API's background prepare writes
#      /data/agent/runtime/prepared.json from /app/agent, and the log has no
#      "agent engine:" line (that is where ErrNoRuntime and prepare failures go);
#      a uid 10001 process cannot read the API's /proc/1/environ (the API is
#      non-dumpable);
#      then, as a control, the API with TIMELY_AGENT_RUNTIME on a missing path
#      must log that line, so the silence above means something.
#
# The image is built in a throwaway BuildKit builder (docker-container
# driver), so its layers and the uv and Python cache mounts never pile up in
# the default builder's cache. A trap removes that builder with its state
# volume, moby/buildkit when this run pulled it and no other builder's
# container still uses it, the containers, networks and volumes this run
# created, the smoke image, and postgres:17 when this run pulled it and no
# other container uses it (an image left behind is named, never forced out).
# Nothing else is touched and nothing is pruned. KEEP_IMAGES=1
# keeps the smoke image and postgres:17.
# SMOKE_IMAGE=<ref> skips the build and checks that image instead (it is then
# never removed).
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
platform=linux/amd64
pg_image=postgres:17
run_id="timely-smoke-$$-$RANDOM"
build=1
image="timely-api:$run_id"
if [[ -n "${SMOKE_IMAGE:-}" ]]; then
  image="$SMOKE_IMAGE"
  build=0
fi

containers=()
networks=()
volumes=()
remove_images=()
scratch=""
builder=""
buildkit_image=moby/buildkit:buildx-stable-1
remove_buildkit=0

# remove_shared_image <image>: removes an image this run pulled unless another
# container (a concurrent smoke run's builder or Postgres) still uses it; says
# what it left behind instead of hiding it.
remove_shared_image() {
  local users
  users="$(docker ps -a --filter "ancestor=$1" --format '{{.Names}}' 2>/dev/null | tr '\n' ' ')"
  if [[ -n "${users// /}" ]]; then
    echo "docker-agent-smoke: left $1 in place, still used by: $users" >&2
  elif ! docker image rm "$1" >/dev/null 2>&1; then
    echo "docker-agent-smoke: could not remove $1 (docker image rm failed); remove it by hand once nothing uses it" >&2
  fi
}

cleanup() {
  local status=$?
  set +e
  for c in "${containers[@]}"; do docker rm -f -v "$c" >/dev/null 2>&1; done
  for n in "${networks[@]}"; do docker network rm "$n" >/dev/null 2>&1; done
  for v in "${volumes[@]}"; do docker volume rm "$v" >/dev/null 2>&1; done
  if [[ "${KEEP_IMAGES:-}" != 1 ]]; then
    for i in "${remove_images[@]}"; do
      if [[ "$i" == "$image" ]]; then docker image rm "$i" >/dev/null 2>&1; else remove_shared_image "$i"; fi
    done
  fi
  # buildx rm stops the BuildKit container and deletes its state volume (the build cache);
  # only then can moby/buildkit go, and only if no other run's builder uses it.
  [[ -n "$builder" ]] && docker buildx rm "$builder" >/dev/null 2>&1
  [[ $remove_buildkit -eq 1 ]] && remove_shared_image "$buildkit_image"
  [[ -n "$scratch" ]] && rm -rf "$scratch"
  if [[ $status -eq 0 ]]; then
    echo "docker-agent-smoke: PASS"
  else
    echo "docker-agent-smoke: FAIL (exit $status)" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

fail() {
  echo "docker-agent-smoke: $*" >&2
  exit 1
}
step() { echo; echo "== $*"; }

command -v docker >/dev/null || fail "docker is not on PATH"
command -v go >/dev/null || fail "go is not on PATH (check 2 builds the agenthost test binary)"
command -v curl >/dev/null || fail "curl is not on PATH (check 3 calls /health)"

scratch="$(mktemp -d "${TMPDIR:-/tmp}/timely-docker-smoke.XXXXXX")"
chmod 755 "$scratch"

# Creates the volume $run_id-$1 and records it for the trap. Not called in a
# command substitution: that subshell would lose the record.
new_volume() {
  docker volume create "$run_id-$1" >/dev/null
  volumes+=("$run_id-$1")
}

# A random secret of 44 characters (the API wants a JWT_SECRET of at least 32).
secret() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }

# docker run as the image's user with a read-only root and a private /tmp.
run_ro() {
  docker run --rm --platform "$platform" --user 10001:10001 --read-only \
    --tmpfs /tmp:rw,nosuid,nodev,size=512m "$@"
}

# ------------------------------------------------------------------ build
if [[ $build -eq 1 ]]; then
  step "build $image ($platform)"
  remove_images+=("$image")
  started=$SECONDS
  docker buildx version >/dev/null 2>&1 || fail "docker buildx is not installed (the build runs in a throwaway builder)"
  docker image inspect "$buildkit_image" >/dev/null 2>&1 || remove_buildkit=1
  builder="$run_id"
  docker buildx create --name "$builder" --driver docker-container >/dev/null
  docker buildx build --builder "$builder" --load --platform "$platform" -f "$repo/apps/api/Dockerfile" \
    --build-arg VERSION=smoke -t "$image" "$repo"
  echo "built in $((SECONDS - started)) s"
else
  step "use $image (SMOKE_IMAGE; no build)"
  docker image inspect "$image" >/dev/null || fail "$image does not exist"
fi
docker image ls "$image"

# ------------------------------------------------------------------ 0. image
step "0. image configuration"
cfg_user="$(docker image inspect -f '{{.Config.User}}' "$image")"
[[ "$cfg_user" == timely ]] || fail "image user is '$cfg_user', want timely"
env_list="$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$image")"
for want in TIMELY_AGENT_RUNTIME=/app/agent TIMELY_DATA_DIR=/data API_BIND=0.0.0.0; do
  grep -qxF "$want" <<<"$env_list" || fail "image env lacks $want"
done
# Without --read-only: the runtime must be read-only to timely by ownership.
docker run --rm --platform "$platform" --entrypoint /bin/sh "$image" -c '
  set -eu
  [ "$(id -u):$(id -g)" = "10001:10001" ] || { echo "runs as $(id -u):$(id -g)"; exit 1; }
  [ "$(stat -c %u /app/agent)" = 0 ] || { echo "/app/agent is not owned by root"; exit 1; }
  [ "$(stat -c %u /data)" = 10001 ] || { echo "/data is not owned by timely"; exit 1; }
  writable=$(find /app/agent ! -type l \( -user 10001 -o -perm -0002 -o \( -group 10001 -perm -0020 \) \) | head -5)
  [ -z "$writable" ] || { echo "timely can write: $writable"; exit 1; }
  if touch /app/agent/.smoke-write 2>/dev/null; then echo "timely wrote into /app/agent"; exit 1; fi
  test -f /app/agent/boot.py -a -f /app/agent/MANIFEST.json -a -x /app/agent/python/bin/python3
  test -f /app/agent/app/timely_agent/boot.py
' || fail "image layout check failed"
docker run --rm --platform "$platform" --entrypoint /app/agent/python/bin/python3 "$image" -I -c \
  'import zoneinfo; print(zoneinfo.ZoneInfo("America/New_York").key)' \
  || fail "zoneinfo cannot resolve America/New_York (tzdata missing?)"
echo "ok: user timely, env defaults, /app/agent root-owned and not writable by timely, /data owned by timely, tzdata"

# ------------------------------------------------------------------ 1. prepare
step "1. boot.py prepare, read-only, uid 10001"
new_volume prepare
vol1="$run_id-prepare"
out1="$(run_ro -v "$vol1:/data" --entrypoint /app/agent/python/bin/python3 "$image" \
  -I /app/agent/boot.py prepare --agent-dir /data/agent)" || { echo "$out1"; fail "prepare exited non-zero"; }
last1="$(tail -n 1 <<<"$out1")"
grep -q '"ok": *true' <<<"$last1" || { echo "$out1"; fail "prepare did not answer ok"; }
grep -q '"seed_skills_dir": *"/data/agent/' <<<"$last1" || { echo "$last1"; fail "prepare's seed tree is not under /data/agent"; }
echo "ok: prepare answered ok with its state under /data/agent"

# ------------------------------------------------------------------ 2. real worker
step "2. TestIntegrationRealWorker inside the image, read-only, uid 10001"
(cd "$repo/apps/api" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go test -c -o "$scratch/agenthost.test" ./internal/agenthost)
chmod 755 "$scratch/agenthost.test"
set +e
out2="$(run_ro -e HOME=/tmp -e TIMELY_AGENT_TEST_RUNTIME=/app/agent -w /tmp \
  -v "$scratch/agenthost.test:/smoke/agenthost.test:ro" --entrypoint /smoke/agenthost.test "$image" \
  -test.run 'TestIntegrationRealWorker$' -test.count=1 -test.v -test.timeout=5m 2>&1)"
status2=$?
set -e
echo "$out2" | tail -n 25
[[ $status2 -eq 0 ]] || fail "TestIntegrationRealWorker failed in the image (exit $status2)"
grep -q -- '--- PASS: TestIntegrationRealWorker' <<<"$out2" || fail "TestIntegrationRealWorker did not run (skipped?)"
grep -q 'ready: hermes ' <<<"$out2" || fail "the worker never reported ready"
echo "ok: the real worker reached ready and finished the stub run"

# ------------------------------------------------------------------ 3. API + Postgres
step "3. API with a throwaway postgres:17 on a private network"
if ! docker image inspect "$pg_image" >/dev/null 2>&1; then
  remove_images+=("$pg_image")
fi
net="$run_id-net"
docker network create "$net" >/dev/null
networks+=("$net")
db_password="$(secret)"
pg="$run_id-db"
containers+=("$pg")
docker run -d --name "$pg" --network "$net" -e POSTGRES_USER=timely -e POSTGRES_PASSWORD="$db_password" \
  -e POSTGRES_DB=timely_db "$pg_image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$pg" pg_isready -U timely -d timely_db -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$pg" pg_isready -U timely -d timely_db -h 127.0.0.1 >/dev/null || fail "postgres did not become ready"

jwt_secret="$(secret)"
# start_api <name> <volume> [docker run options...]: the API on the private
# network, read-only, published only on a loopback port Docker picks.
start_api() {
  local name="$1" volume="$2"
  shift 2
  containers+=("$name")
  docker run -d --name "$name" --platform "$platform" --network "$net" -p 127.0.0.1::8080 \
    --read-only --tmpfs /tmp:rw,nosuid,nodev,size=512m -v "$volume:/data" \
    -e API_PORT=8080 -e DB_HOST="$pg" -e DB_PORT=5432 -e DB_USER=timely -e DB_PASSWORD="$db_password" \
    -e DB_NAME=timely_db -e DB_SSLMODE=disable -e JWT_SECRET="$jwt_secret" \
    "$@" "$image" >/dev/null
}
# api_port <name>: the published loopback port, once the container runs.
api_port() {
  local port=""
  for _ in $(seq 1 20); do
    if [[ "$(docker inspect -f '{{.State.Status}}' "$1")" == exited ]]; then
      docker logs "$1" 2>&1 | tail -n 20 >&2
      fail "$1 exited at start"
    fi
    port="$(docker port "$1" 8080/tcp 2>/dev/null | head -n 1 | sed 's/.*://')"
    [[ "$port" =~ ^[0-9]+$ ]] && break
    sleep 0.5
  done
  [[ "$port" =~ ^[0-9]+$ ]] || fail "no published port for $1"
  [[ "$port" != 8080 && "$port" != 4001 ]] || fail "Docker picked port $port"
  echo "$port"
}

new_volume apidata
api="$run_id-api"
start_api "$api" "$run_id-apidata"
host_port="$(api_port "$api")"
echo "API on 127.0.0.1:$host_port"
healthy=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$host_port/health" >"$scratch/health" 2>/dev/null; then healthy=1; break; fi
  [[ "$(docker inspect -f '{{.State.Running}}' "$api")" == true ]] || break
  sleep 1
done
if [[ $healthy -ne 1 ]]; then
  docker logs "$api" 2>&1 | tail -n 40
  fail "/health did not answer"
fi
echo "/health: $(head -c 200 "$scratch/health")"
# Workers and their terminal commands run as uid 10001 like the API: none may read
# its environment (JWT_SECRET, DB_PASSWORD, compose's .env keys) through /proc.
[[ "$(docker exec "$api" cat /proc/1/comm)" == timely-api ]] || fail "PID 1 is not the API"
if docker exec "$api" env -i /bin/sh -c 'cat /proc/1/environ' >/dev/null 2>&1; then
  fail "a uid 10001 process can read the API's /proc/1/environ (procguard.Harden did not run)"
fi
echo "ok: a uid 10001 process cannot read the API's environment"
prepared=0
for _ in $(seq 1 120); do
  if docker exec "$api" test -s /data/agent/runtime/prepared.json 2>/dev/null; then prepared=1; break; fi
  docker logs "$api" 2>&1 | grep -q 'agent engine:' && break
  sleep 1
done
logs="$(docker logs "$api" 2>&1)"
if grep -n 'agent engine:' <<<"$logs"; then
  fail "the API log reports an agent engine problem (lines above)"
fi
[[ $prepared -eq 1 ]] || { tail -n 40 <<<"$logs"; fail "the API's prepare never wrote /data/agent/runtime/prepared.json"; }
docker exec "$api" grep -q '"seed_skills_dir": "/data/agent/' /data/agent/runtime/prepared.json \
  || fail "prepared.json does not place the seed tree under /data/agent"
echo "ok: /health answers, the runtime resolved to /app/agent and the API's prepare wrote /data/agent/runtime/prepared.json"

# The log check above passes on silence, so prove it is not vacuous: the same
# image with a runtime path that does not exist must log the agent engine line.
step "3b. control: a missing runtime is reported in the API log"
docker rm -f -v "$api" >/dev/null
new_volume control
control="$run_id-control"
start_api "$control" "$run_id-control" -e TIMELY_AGENT_RUNTIME=/app/no-such-agent
api_port "$control" >/dev/null
reported=0
for _ in $(seq 1 60); do
  if docker logs "$control" 2>&1 | grep -q "agent engine: The new engine's runtime is not installed"; then reported=1; break; fi
  sleep 1
done
[[ $reported -eq 1 ]] || { docker logs "$control" 2>&1 | tail -n 20; fail "a missing runtime was not reported, so the check above proves nothing"; }
docker logs "$control" 2>&1 | grep 'agent engine:' | head -n 1
echo "ok: the log check catches a runtime that does not resolve"
