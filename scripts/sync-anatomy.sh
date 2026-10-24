#!/usr/bin/env bash
# Copies the anatomy skill (isometric SVG explainer figures) into
# .agents/skills/anatomy and links it from .claude/skills, so cloud sessions
# get it without a per-user install.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST="$REPO_ROOT/.agents/skills/anatomy"
LINK="$REPO_ROOT/.claude/skills/anatomy"
REF=${ANATOMY_REF:-main}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git clone --quiet --depth 1 --branch "$REF" https://github.com/wheresryan22/anatomy.git "$tmp/anatomy"
src="$tmp/anatomy"
[[ -f "$src/SKILL.md" ]] || { echo "SKILL.md not found in wheresryan22/anatomy@$REF" >&2; exit 1; }
commit=$(git -C "$src" rev-parse HEAD)

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$src/SKILL.md" "$src/README.md" "$src/LICENSE" "$src/references" "$src/kit" "$src/scripts" "$src/tests" "$src/examples" "$DEST/"
find "$DEST/examples" -type f \( -name '*.html' -o -name '*.pdf' \) -delete

cat >"$DEST/UPSTREAM.md" <<EOF
# Vendored anatomy

Copied verbatim from https://github.com/wheresryan22/anatomy/tree/$commit (MIT, see LICENSE).
Update with \`make anatomy-sync\`; never edit these files by hand.

Left out: the built example pages and PDFs (\`examples/**/*.html\`, \`*.pdf\`, about 24 MB; rebuild one with
\`node examples/<name>/build.mjs [--light]\`), and \`.github/\`, \`evals/\`, \`agents/\` and the contributor docs.

Its checks find Chrome in the usual install paths only. In a cloud session, run them with
\`CHROME_PATH=/opt/pw-browsers/chromium\`.
EOF

mkdir -p "$(dirname "$LINK")"
ln -sfn ../../.agents/skills/anatomy "$LINK"

echo "anatomy ($commit) copied to .agents/skills/anatomy"
