#!/usr/bin/env bash
# verify-timely: launch, check and tear down an isolated Timely stack
# (API :8081 in its own DB schema, web :4002) from a scratch git worktree that
# mirrors the source checkout's working tree. Never touches :8080 or :4001.
#
#   verify-timely.sh up        # sync worktree, install, start API + web, wait until usable
#   verify-timely.sh doctor    # read-only: is this instance ours, current and healthy?
#   verify-timely.sh status    # pids, ports, state paths
#   verify-timely.sh browser   # (re)start only the headless Chromium (fresh profile = signed out)
#   verify-timely.sh logs [api|web|browser]
#   verify-timely.sh down [--keep-worktree]   # stop what `up` started; evidence is never touched
set -euo pipefail

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# The checkout whose code is under test: wherever the skill is run from.
SRC=${VERIFY_TIMELY_SRC:-$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || git -C "$SKILL_DIR" rev-parse --show-toplevel)}
STATE=${VERIFY_TIMELY_STATE:-${XDG_CACHE_HOME:-$HOME/.cache}/verify-timely}
WT="$STATE/wt"
LOGS="$STATE/logs"
API_PORT=8081
WEB_PORT=4002
CDP_PORT=${VERIFY_TIMELY_CDP_PORT:-9339}
SCHEMA=${VERIFY_TIMELY_SCHEMA:-verify_timely}
FORBIDDEN_PORTS=(8080 4001)

say() { printf '[verify-timely] %s\n' "$*" >&2; }
die() { say "ERROR: $*"; exit 1; }

listener_pid() { # first pid listening on TCP port $1, or empty
  ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true
}
sid_of() { ps -o sid= -p "$1" 2>/dev/null | tr -d ' ' || true; }
# Each service runs in its own session (setsid). air and next put their children
# in new process groups, but every descendant keeps the session id, so the
# session is what this skill records, checks and kills.
saved_sid() { if [[ -f "$STATE/$1.sid" ]]; then cat "$STATE/$1.sid"; fi; }
session_pids() { [[ -n "$1" ]] && ps -eo pid=,sid= | awk -v s="$1" '$2==s{print $1}' || true; }
session_alive() { [[ -n "$1" && -n "$(session_pids "$1")" ]]; }

# A pid is ours when it lives in a session that `up` recorded.
is_ours() {
  local s; s=$(sid_of "$1")
  [[ -n "$s" ]] || return 1
  for name in api web browser; do [[ "$(saved_sid $name)" == "$s" ]] && return 0; done
  return 1
}

guard_port() {
  for p in "${FORBIDDEN_PORTS[@]}"; do [[ "$1" != "$p" ]] || die "refusing to touch port $1 (the user's own dev server)"; done
}

# AGENTS.md: if something else holds 8081/4002, stop it before launching.
# Stops only the listener and a dev-runner parent (air / next dev) that would respawn it.
free_port() {
  local port=$1 pid ppid pcmd
  guard_port "$port"
  pid=$(listener_pid "$port")
  [[ -n "$pid" ]] || return 0
  if is_ours "$pid"; then return 0; fi
  ppid=$(ps -o ppid= -p "$pid" | tr -d ' ')
  pcmd=$(tr '\0' ' ' < "/proc/$ppid/cmdline" 2>/dev/null || true)
  say "port $port is held by a process this skill did not start: pid $pid ($(tr '\0' ' ' < /proc/$pid/cmdline | cut -c1-120)); stopping it"
  if [[ "$pcmd" =~ (^|/)air( |$)|next\ dev ]]; then kill "$ppid" 2>/dev/null || true; fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do [[ -z "$(listener_pid "$port")" ]] && return 0; sleep 0.5; done
  pid=$(listener_pid "$port"); [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  sleep 1
  [[ -z "$(listener_pid "$port")" ]] || die "could not free port $port"
}

src_fingerprint() { # HEAD + tracked diff + untracked file list of a checkout
  local dir=$1
  { git -C "$dir" rev-parse HEAD; git -C "$dir" diff HEAD --binary -- . ':(exclude).agents/skills/verify-timely'; git -C "$dir" ls-files -o --exclude-standard -- . ':(exclude).agents/skills/verify-timely' | sort; } | sha1sum | cut -d' ' -f1
}

sync_worktree() {
  mkdir -p "$STATE" "$LOGS"
  local head; head=$(git -C "$SRC" rev-parse HEAD)
  if [[ ! -e "$WT/.git" ]]; then
    git -C "$SRC" worktree prune
    say "creating detached scratch worktree $WT at $head"
    git -C "$SRC" worktree add --detach "$WT" "$head" >/dev/null
  else
    git -C "$WT" checkout --quiet --detach --force "$head"
    git -C "$WT" clean -fdq   # untracked, non-ignored only: node_modules, .next and .env survive
  fi
  # Mirror the source checkout's uncommitted state (tracked edits + new files).
  local patch="$STATE/src.patch"
  git -C "$SRC" diff HEAD --binary > "$patch"
  if [[ -s "$patch" ]]; then git -C "$WT" apply --whitespace=nowarn "$patch"; fi
  (cd "$SRC" && git ls-files -o --exclude-standard -z | tar --null -T - -cf -) | tar -xf - -C "$WT"
  src_fingerprint "$SRC" > "$STATE/fingerprint"
  # The worktree's root .env is a copy of the source checkout's (make setup-env).
  [[ -f "$WT/.env" ]] || cp "$SRC/.env" "$WT/.env"
  if ! cmp -s "$SRC/.env" "$WT/.env"; then cp "$SRC/.env" "$WT/.env"; fi
  chmod 600 "$WT/.env"
}

start_group() { # name, dir, command...  (own session so `down` can kill every descendant)
  local name=$1 dir=$2; shift 2
  rm -f "$STATE/$name.sid"
  (cd "$dir" && exec setsid bash -c 'echo $$ > "$0"; exec "$@"' "$STATE/$name.sid" "$@") > "$LOGS/$name.log" 2>&1 < /dev/null &
  for _ in $(seq 1 50); do [[ -s "$STATE/$name.sid" ]] && break; sleep 0.1; done
  say "$name started (session $(saved_sid "$name")), log: $LOGS/$name.log"
}

wait_api() {
  say "waiting for API /health on :$API_PORT (first build + migrations can take a minute)"
  for _ in $(seq 1 240); do
    if curl -fsS "http://127.0.0.1:$API_PORT/health" 2>/dev/null | grep -q '"status":"ok"'; then say "API ready"; return 0; fi
    session_alive "$(saved_sid api)" || { tail -30 "$LOGS/api.log" >&2; die "API process exited"; }
    sleep 1
  done
  tail -30 "$LOGS/api.log" >&2; die "API not healthy after 240s"
}

wait_web() {
  say "waiting for web on :$WEB_PORT (first compile of /signup)"
  for _ in $(seq 1 240); do
    local code; code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "http://127.0.0.1:$WEB_PORT/signup" || true)
    if [[ "$code" == 200 ]]; then
      # Usable means the proxy reaches *our* API, not only that Next answers.
      if curl -fsS --max-time 30 "http://127.0.0.1:$WEB_PORT/api-proxy/health" 2>/dev/null | grep -q '"status":"ok"'; then say "web ready"; return 0; fi
    fi
    session_alive "$(saved_sid web)" || { tail -30 "$LOGS/web.log" >&2; die "web process exited"; }
    sleep 1
  done
  tail -30 "$LOGS/web.log" >&2; die "web not ready after 240s"
}

start_browser() {
  local chrome
  chrome=$(cd "$SRC" && node -e "console.log(require('@playwright/test').chromium.executablePath())")
  [[ -x "$chrome" ]] || die "Playwright Chromium missing ($chrome); run 'make install-browser' in $SRC"
  free_port "$CDP_PORT"
  rm -rf "$STATE/browser-profile"
  start_group browser "$STATE" "$chrome" --headless=new --remote-debugging-address=127.0.0.1 --remote-debugging-port="$CDP_PORT" \
    --user-data-dir="$STATE/browser-profile" --no-first-run --no-default-browser-check --window-size=1440,900 about:blank
  for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && { say "browser ready (CDP :$CDP_PORT)"; return 0; }; sleep 0.2; done
  die "headless Chromium did not open CDP on :$CDP_PORT"
}

cmd_up() {
  [[ -f "$SRC/.env" ]] || die "no root .env in $SRC; run 'make setup-env' there first"
  if session_alive "$(saved_sid api)" || session_alive "$(saved_sid web)" || session_alive "$(saved_sid browser)"; then
    say "a previous verify stack is running; stopping it first"; cmd_down --keep-worktree
  fi
  free_port "$API_PORT"; free_port "$WEB_PORT"
  sync_worktree
  say "pnpm install in the worktree (about 45 s the first time)"
  (cd "$WT" && pnpm install --frozen-lockfile --prefer-offline > "$LOGS/install.log" 2>&1) || { tail -30 "$LOGS/install.log" >&2; die "pnpm install failed"; }
  # Command-line make variables override the .env include and reach the recipe's environment.
  start_group api "$WT" make --no-print-directory dev-worktree-api DB_SCHEMA="$SCHEMA" ALLOW_REGISTRATION=true
  wait_api
  start_group web "$WT" make --no-print-directory dev-worktree-web
  wait_web
  start_browser
  date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE/started"
  cmd_doctor
}

check() { # label, condition-command...
  local label=$1; shift
  if "$@" >/dev/null 2>&1; then printf '  ok    %s\n' "$label"; else printf '  FAIL  %s\n' "$label"; DOCTOR_FAIL=1; fi
}

proc_env() { tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null | grep "^$2=" | cut -d= -f2- || true; }

cmd_doctor() {
  DOCTOR_FAIL=0
  local api_pid web_pid health
  api_pid=$(listener_pid "$API_PORT"); web_pid=$(listener_pid "$WEB_PORT")
  echo "verify-timely doctor  (src $SRC, worktree $WT, schema $SCHEMA)"
  check "API :$API_PORT is listening"                      test -n "$api_pid"
  check "API listener is in this skill's api session"      test -n "$api_pid" -a "$(sid_of "${api_pid:-0}")" == "$(saved_sid api)"
  check "API runs from the scratch worktree"                bash -c "[[ \"\$(readlink /proc/$api_pid/cwd)\" == '$WT/apps/api' ]]"
  check "API env DB_SCHEMA=$SCHEMA"                         test "$(proc_env "${api_pid:-0}" DB_SCHEMA)" == "$SCHEMA"
  check "API env API_PORT=$API_PORT"                        test "$(proc_env "${api_pid:-0}" API_PORT)" == "$API_PORT"
  health=$(curl -fsS --max-time 5 "http://127.0.0.1:$API_PORT/health" 2>/dev/null || true)
  check "API /health status ok, db ok"                      bash -c "grep -q '\"status\":\"ok\"' <<<'$health' && grep -q '\"db\":\"ok\"' <<<'$health'"
  check "API /health registrationOpen true"                 bash -c "grep -q '\"registrationOpen\":true' <<<'$health'"
  check "web :$WEB_PORT is listening"                       test -n "$web_pid"
  check "web listener is in this skill's web session"      test -n "$web_pid" -a "$(sid_of "${web_pid:-0}")" == "$(saved_sid web)"
  check "web runs from the scratch worktree"                bash -c "[[ \"\$(readlink /proc/$web_pid/cwd)\" == '$WT/apps/web' ]]"
  local next_pid; next_pid=$(pgrep -s "$(saved_sid web)" -f next-server | head -1 || true)
  check "web proxies to API_ORIGIN=http://localhost:$API_PORT" test "$(proc_env "${next_pid:-0}" API_ORIGIN)" == "http://localhost:$API_PORT"
  check "web /api-proxy/health reaches the :$API_PORT API"  bash -c "curl -fsS --max-time 20 http://127.0.0.1:$WEB_PORT/api-proxy/health | grep -q '\"status\":\"ok\"'"
  check "worktree matches the source checkout (HEAD + diff)" test "$(cat "$STATE/fingerprint" 2>/dev/null)" == "$(src_fingerprint "$SRC")"
  local cdp_pid; cdp_pid=$(listener_pid "$CDP_PORT")
  check "verify browser CDP :$CDP_PORT is in this skill's browser session" test -n "$cdp_pid" -a "$(sid_of "${cdp_pid:-0}")" == "$(saved_sid browser)"
  local user_ports_ok=0 p up
  for p in "${FORBIDDEN_PORTS[@]}"; do
    up=$(listener_pid "$p"); [[ -n "$up" ]] && is_ours "$up" && user_ports_ok=1
  done
  check "nothing of ours listens on :8080 or :4001"         test "$user_ports_ok" == 0
  echo "  info  health: ${health:-<none>}"
  if [[ $DOCTOR_FAIL -ne 0 ]]; then echo "doctor: NOT OK - do not drive this instance"; return 1; fi
  echo "doctor: OK - drive http://127.0.0.1:$WEB_PORT"
}

kill_group() {
  local name=$1 s pids; s=$(saved_sid "$name")
  [[ -n "$s" ]] || return 0
  pids=$(session_pids "$s")
  if [[ -n "$pids" ]]; then
    kill -TERM $pids 2>/dev/null || true
    for _ in $(seq 1 20); do session_alive "$s" || break; sleep 0.5; done
    pids=$(session_pids "$s"); [[ -z "$pids" ]] || kill -KILL $pids 2>/dev/null || true
    say "stopped $name (session $s)"
  fi
  rm -f "$STATE/$name.sid"
}

cmd_down() {
  local keep=0; [[ "${1:-}" == "--keep-worktree" ]] && keep=1
  kill_group browser; kill_group web; kill_group api
  for p in $API_PORT $WEB_PORT $CDP_PORT; do
    local pid; pid=$(listener_pid "$p")
    [[ -z "$pid" ]] || say "warning: port $p still held by pid $pid (not started by this skill, left alone)"
  done
  if [[ $keep -eq 0 && -e "$WT/.git" ]]; then
    git -C "$SRC" worktree remove --force "$WT" && say "removed worktree $WT"
    git -C "$SRC" worktree prune
  fi
  rm -rf "$STATE/browser-profile"
  say "down. Evidence is kept in $SKILL_DIR/evidence/"
}

cmd_status() {
  for n in api web browser; do
    local g; g=$(saved_sid $n)
    printf '%-8s session=%-8s %s\n' "$n" "${g:--}" "$(session_alive "$g" && echo running || echo stopped)"
  done
  printf 'ports    8081=%s 4002=%s cdp:%s=%s\n' "$(listener_pid $API_PORT)" "$(listener_pid $WEB_PORT)" "$CDP_PORT" "$(listener_pid "$CDP_PORT")"
  printf 'state    %s\nworktree %s\nevidence %s\n' "$STATE" "$WT" "$SKILL_DIR/evidence"
}

case "${1:-}" in
  up) cmd_up ;;
  doctor) cmd_doctor ;;
  down) shift; cmd_down "${1:-}" ;;
  status) cmd_status ;;
  browser) mkdir -p "$LOGS"; kill_group browser; start_browser ;;
  logs) tail -n "${3:-60}" "$LOGS/${2:-api}.log" ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
