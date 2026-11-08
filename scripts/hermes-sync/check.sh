#!/usr/bin/env bash
# Post-sync checks for apps/agent (plan section 10.4). `make hermes-sync-check` runs this.
# Implemented so far: the link to the last snapshot, the patch inventory (10.4 b) and the
# no-npm-manifest/no-env-file rule (part of 10.4 e). Later phase-1 work adds the rest here:
# compileall, agent-install + import smoke, tools/skills/seams dumps, policy files, contract tests.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PREFIX=apps/agent/hermes
PATCHES=apps/agent/.hermes-sync/patches.md
g() { git -C "$REPO_ROOT" "$@"; }
fail=0
bad() { echo "hermes-sync-check: $*" >&2; fail=1; }

snap=$(g log -1 --format=%H --all-match --grep='^hermes: snapshot ' --grep='^Hermes-Commit: ' HEAD)
[[ -n $snap ]] || { echo "hermes-sync-check: no Hermes snapshot in HEAD's history; run make hermes-sync" >&2; exit 1; }
[[ $(g rev-parse "HEAD:$PREFIX/HERMES_UPSTREAM.json") == $(g rev-parse "$snap:$PREFIX/HERMES_UPSTREAM.json") ]] ||
  bad "$PREFIX/HERMES_UPSTREAM.json differs from snapshot $snap"

# b. Every vendored file that differs from the snapshot (committed or not) is a listed patch point
# with its TIMELY(Pn) marker. patches.md lists each file as `apps/agent/hermes/<path>` in backticks.
listed=$( [[ -f $REPO_ROOT/$PATCHES ]] && grep -o "\`$PREFIX/[^\`]*\`" "$REPO_ROOT/$PATCHES" | tr -d '`' | sort -u || true)
while IFS= read -r f; do
  [[ -z $f ]] && continue
  if ! grep -qxF "$f" <<<"$listed"; then
    bad "$f differs from upstream but is not listed in $PATCHES"
  elif [[ -f $REPO_ROOT/$f ]] && ! grep -q 'TIMELY(P[0-9]\+)' "$REPO_ROOT/$f"; then
    bad "$f is listed in $PATCHES but has no TIMELY(Pn) marker"
  fi
done < <(g diff --name-only "$snap" -- "$PREFIX"; g ls-files --others --exclude-standard -- "$PREFIX")
count=$(grep -c . <<<"$listed" || true)
((count <= 5)) || bad "$count patch points listed; the hard cap is five"

# e (part). No npm manifests, JS lockfiles or env files inside the copy (uv.lock and pm/lock.json are expected).
while IFS= read -r f; do
  case "${f##*/}" in
    package.json | package-lock.json | pnpm-lock.yaml | yarn.lock | .env | .env.*) bad "$f must not be in the copy (filter it out)" ;;
  esac
done < <(g ls-files -- "$PREFIX")

((fail == 0)) || exit 1
echo "hermes-sync-check: snapshot $(g log -1 --format='%(trailers:key=Hermes-Tag,valueonly)' "$snap" | head -n1) linked, $count patch points, no npm or env files"
