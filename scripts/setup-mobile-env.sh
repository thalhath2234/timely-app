#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST="$REPO_ROOT/apps/mobile/.env.local"

if [[ -f "$DEST" ]]; then
  echo "mobile development env already exists: $DEST"
  exit 0
fi

COMMON_GIT_DIR=$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)
SOURCE_ROOT=$(dirname "$COMMON_GIT_DIR")

for source in \
  "$SOURCE_ROOT/apps/mobile/.env.local" \
  "$SOURCE_ROOT/apps/mobile/.env" \
  "$REPO_ROOT/apps/mobile/.env"
do
  if [[ -f "$source" && "$source" != "$DEST" ]]; then
    cp "$source" "$DEST"
    chmod 600 "$DEST"
    echo "created $DEST from $source"
    exit 0
  fi
done

cp "$REPO_ROOT/apps/mobile/.env.example" "$DEST"
chmod 600 "$DEST"
echo "created $DEST from .env.example"
echo "Update EXPO_PUBLIC_API_URL before using a physical phone."
