#!/usr/bin/env bash
# Prints the snapshot commit for a Hermes tag (vX.Y.Z, found by its `hermes: snapshot <tag>`
# message and Hermes-Commit trailer in any local ref) or for a commit-ish. `make hermes-sync-report`.
set -euo pipefail
ref=${1:?usage: snapshot-of.sh <vX.Y.Z or commit>}
if [[ $ref =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  found=$(git log -1 --all --format=%H --all-match --grep="^hermes: snapshot ${ref//./\\.}\$" --grep='^Hermes-Commit: ')
  [[ -n $found ]] || { echo "snapshot-of: no snapshot commit for $ref in any local ref" >&2; exit 1; }
  echo "$found"
else
  git rev-parse --verify "$ref^{commit}"
fi
