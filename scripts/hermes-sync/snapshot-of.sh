#!/usr/bin/env bash
# Prints the snapshot commit for a Hermes tag (vX.Y.Z: the real `hermes: snapshot <tag>` commit,
# preferring the one HEAD links to, never a rebased replay; check_lib.py snapshot_of) or for a
# commit-ish. `make hermes-sync-report`.
set -euo pipefail
ref=${1:?usage: snapshot-of.sh <vX.Y.Z or commit>}
if [[ $ref =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  exec python3 -I -B "$(dirname "${BASH_SOURCE[0]}")/check_lib.py" snapshot-of "$ref" "$(git rev-parse --show-toplevel)"
else
  git rev-parse --verify "$ref^{commit}"
fi
