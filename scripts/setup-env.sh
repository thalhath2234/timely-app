#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST="$REPO_ROOT/.env"

if [[ -f "$DEST" ]]; then
  echo "env file already exists: $DEST"
  exit 0
fi

# In a worktree, reuse the main checkout's .env so the secrets and API URL match.
COMMON_GIT_DIR=$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)
SOURCE="$(dirname "$COMMON_GIT_DIR")/.env"

if [[ -f "$SOURCE" && "$SOURCE" != "$DEST" ]]; then
  cp "$SOURCE" "$DEST"
  chmod 600 "$DEST"
  echo "created $DEST from $SOURCE"
  exit 0
fi

cp "$REPO_ROOT/.env.example" "$DEST"
chmod 600 "$DEST"
echo "created $DEST from .env.example"
echo "Replace JWT_SECRET, and update EXPO_PUBLIC_API_URL before using a physical phone."
