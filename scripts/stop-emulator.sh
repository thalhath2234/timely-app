#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SKILL_SCRIPT=""
for candidate in \
  "$REPO_ROOT/.agents/skills/android-emulator/scripts/stop-emulator.sh" \
  "$HOME/.cursor/skills/android-emulator/scripts/stop-emulator.sh"
do
  if [[ -x "$candidate" ]]; then
    SKILL_SCRIPT="$candidate"
    break
  fi
done
if [[ -z "$SKILL_SCRIPT" ]]; then
  echo "Could not find stop-emulator.sh from the android-emulator skill." >&2
  exit 1
fi
exec "$SKILL_SCRIPT" "$@"
