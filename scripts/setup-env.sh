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

# The API refuses to start with the placeholder secrets, so generate real ones.
random_secret() { openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64; }
tmp=$(mktemp "$DEST.XXXXXX")
jwt=$(random_secret)
backup=$(random_secret)
awk -v jwt="$jwt" -v backup="$backup" '
  /^JWT_SECRET=replace-with-/ { print "JWT_SECRET=" jwt; next }
  /^TIMELY_BACKUP_KEY=replace-with-/ { print "TIMELY_BACKUP_KEY=" backup; next }
  { print }
' "$DEST" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$DEST"

echo "created $DEST from .env.example with fresh JWT_SECRET and TIMELY_BACKUP_KEY"
echo "Update EXPO_PUBLIC_API_URL before using a physical phone."
