#!/usr/bin/env bash
# Copies Cursor's pstack plugin into .agents/pstack. Cloud project sessions only
# get plugins enabled on the claude.ai account, so .claude/settings.json alone
# never gives them pstack; the vendored copy does.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST="$REPO_ROOT/.agents/pstack"
AGENTS_DIR="$REPO_ROOT/.claude/agents"
REF=${PSTACK_REF:-main}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git clone --quiet --depth 1 --branch "$REF" https://github.com/cursor/plugins.git "$tmp/plugins"
src="$tmp/plugins/pstack"
[[ -d "$src/skills" ]] || { echo "pstack/skills not found in cursor/plugins@$REF" >&2; exit 1; }
commit=$(git -C "$tmp/plugins" rev-parse HEAD)
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$src/plugin.json")

rm -rf "$DEST"
mkdir -p "$DEST/docs/guide"
cp -R "$src/skills" "$src/agents" "$DEST/"
cp -R "$src/docs/harness" "$DEST/docs/"
cp "$src"/docs/guide/*.md "$DEST/docs/guide/"
cp "$src/README.md" "$src/LICENSE" "$src/plugin.json" "$DEST/"

cat >"$DEST/UPSTREAM.md" <<EOF
# Vendored pstack

Copied verbatim from https://github.com/cursor/plugins/tree/$commit/pstack (pstack $version, MIT, see LICENSE).
Update with \`make pstack-sync\`; never edit these files by hand.

Left out: \`assets/\` and \`docs/guide/images/\` (pictures only), and \`automations/benny\`, which needs Cursor Automations and Slack.
EOF

mkdir -p "$AGENTS_DIR"
for link in "$AGENTS_DIR"/*.md; do
  if [[ -L "$link" && $(readlink "$link") == ../../.agents/pstack/* ]]; then
    rm "$link"
  fi
done
for agent in "$DEST"/agents/*.md; do
  name=$(basename "$agent")
  ln -s "../../.agents/pstack/agents/$name" "$AGENTS_DIR/$name"
done

echo "pstack $version ($commit) copied to .agents/pstack"
