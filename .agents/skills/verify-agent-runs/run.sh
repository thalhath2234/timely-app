#!/usr/bin/env bash
# Model-check the Agent run apply protocol (see SKILL.md).
#
#   run.sh             read guards from the code, check drift, run TLC (~10 s)
#   run.sh --mutants   also prove each guard matters: remove it in the model
#                      and expect TLC to find a violation (~20 s more)
#   run.sh --resync    after you confirmed the model matches the code: record
#                      the covered functions at HEAD and move the sync commit
#
# Exit: 0 pass and in sync | 1 property violated | 2 model no longer matches
#       the code | 3 pass, but covered code changed since the sync commit
set -euo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
SKILL="$ROOT/.agents/skills/verify-agent-runs"
LOCK="$SKILL/coverage.lock"

# TLA+ tools, pinned. Cached outside the repo.
TLA_VERSION="v1.7.4"
TLA_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
CACHE="${TIMELY_VERIFY_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/timely-verify}"
JAR="$CACHE/tla2tools-$TLA_VERSION.jar"

mode="check"
case "${1:-}" in
  "") ;;
  --mutants) mode="mutants" ;;
  --resync) mode="resync" ;;
  *) echo "usage: $0 [--mutants|--resync]" >&2; exit 64 ;;
esac

command -v java >/dev/null || { echo "java not found (TLC needs Java 11+)" >&2; exit 2; }
command -v go >/dev/null || { echo "go not found" >&2; exit 2; }

if [[ ! -f "$JAR" ]]; then
  mkdir -p "$CACHE"
  echo "downloading tla2tools $TLA_VERSION to $CACHE"
  curl -fsSL -o "$JAR.part" "https://github.com/tlaplus/tlaplus/releases/download/$TLA_VERSION/tla2tools.jar"
  mv "$JAR.part" "$JAR"
fi
echo "$TLA_SHA256  $JAR" | sha256sum -c --quiet - || { echo "tla2tools checksum mismatch: delete $JAR" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/verify-agent-runs.XXXXXX")"
trap 'rm -rf -- "${WORK:?}"' EXIT
cp "$SKILL/model/AgentRunApply.tla" "$WORK/"

tlc() { # tlc CONFIG METADIR -> prints TLC output
  (cd "$WORK" && java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto \
     -metadir "$2" -config "$1" AgentRunApply.tla 2>&1)
}

set +e
(cd "$ROOT" && go run "$SKILL/tools/coverage.go" -repo "$ROOT" -lock "$LOCK" \
   -template "$SKILL/model/AgentRunApply.cfg" -out "$WORK/AgentRunApply.cfg" 2> >(grep -v '^exit status' >&2))
cov=$?
set -e
if [[ $cov -eq 2 ]]; then
  echo "Not running TLC: fix the model or the anchors first (SKILL.md, 'Reading a result')."
  exit 2
fi
skill_sync="$(sed -n 's/^Sync commit: `\([0-9a-f]*\)`.*/\1/p' "$SKILL/SKILL.md")"
lock_sync="$(sed -n 's/^sync //p' "$LOCK")"
[[ "$skill_sync" == "$lock_sync" ]] || echo "warning: SKILL.md sync commit ($skill_sync) differs from coverage.lock ($lock_sync)"

echo "running TLC on the model with those guards..."
start=$SECONDS
out="$(tlc AgentRunApply.cfg "$WORK/states" || true)"   # TLC exits non-zero on a violation
if grep -q "Model checking completed. No error has been found." <<<"$out"; then
  echo "$out" | grep -E "distinct states found|depth of the complete"
  echo "PASS: every interleaving within the bounds keeps the properties ($((SECONDS - start)) s)"
  result=0
else
  echo "$out" | sed -n '/^Error:/,$p'
  echo
  echo "Trace summary (one line per state: action | conversations row | writes per step | workers):"
  echo "$out" | awk '
    function flush() { if (act != "") printf "  %-3s %-13s | %-8s lease=%s %-6s plan=%s | writes=%s | %s\n", n, act, st, ls, (ex == "TRUE" ? "expired" : ""), pl, wr, pcs }
    /^State [0-9]+:/ { flush(); n = $2; sub(":", "", n); act = $3; gsub("[<>]", "", act); if (act == "Initial") act = "Init" }
    /^\/\\ row = \[ status/ { st = $7; gsub("[\",]", "", st) }
    /^  lease \|->/ { ls = $3; gsub(",", "", ls) }
    /^  expired \|->/ { ex = $3; gsub(",", "", ex) }
    /^  plan \|->/ { pl = $0; sub("^  plan [|]-> ", "", pl); sub(",$", "", pl); gsub("\"", "", pl) }
    /^\/\\ writes =/ { wr = $0; sub("^.* = ", "", wr) }
    /^\/\\ pc =/ { pcs = $0; sub("^/\\\\ pc = ", "", pcs); gsub("\"", "", pcs) }
    END { flush() }'
  echo "FAIL: TLC found a behaviour that breaks a property (trace above)."
  echo "Read it with SKILL.md, 'Reading a counterexample'."
  exit 1
fi

if [[ $mode == "mutants" ]]; then
  echo "mutants: each guard removed in the model must break a property"
  bad=0
  for g in ClaimLocksRow StepFenced WritesInStepTx ApplySkipsDone CheckpointFenced CheckpointReadsLatest RetryKeepsDone; do
    sed -E "s/^(\s*$g\s*=\s*)TRUE/\1FALSE/" "$WORK/AgentRunApply.cfg" > "$WORK/m-$g.cfg"
    v="$( (tlc "m-$g.cfg" "$WORK/st-$g" || true) | sed -n 's/^Error: Invariant \(.*\) is violated\./\1/p' | head -1)"
    if [[ -n $v ]]; then printf '  %-22s removed -> %s violated\n' "$g" "$v"; else printf '  %-22s removed -> NO VIOLATION (model lost its teeth)\n' "$g"; bad=1; fi
  done
  [[ $bad -eq 0 ]] || exit 1
fi

if [[ $mode == "resync" ]]; then
  covered_files=(apps/api/internal/features/chat/runner.go apps/api/internal/features/chat/service.go
                 apps/api/internal/features/chat/receipts.go apps/api/cmd/agent_deps.go apps/api/cmd/main.go)
  if ! git -C "$ROOT" diff --quiet HEAD -- "${covered_files[@]}"; then
    echo "covered files have uncommitted changes; commit them first so the sync commit contains them" >&2
    exit 2
  fi
  head="$(git -C "$ROOT" rev-parse HEAD)"
  (cd "$ROOT" && go run "$SKILL/tools/coverage.go" -repo "$ROOT" -lock "$LOCK" -resync "$head")
  sed -i "s/^Sync commit: \`[0-9a-f]*\`/Sync commit: \`$head\`/" "$SKILL/SKILL.md"
  echo "sync commit moved to $head in coverage.lock and SKILL.md"
  exit 0
fi

if [[ $cov -eq 3 ]]; then
  echo "The model passes, but covered code changed since the sync commit: review it (SKILL.md, 'When the covered code changed')."
  exit 3
fi
exit $result
