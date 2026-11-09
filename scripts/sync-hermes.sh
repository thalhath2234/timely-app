#!/usr/bin/env bash
# Copies one Hermes Agent release into apps/agent/hermes as a filtered snapshot commit, parented on
# the previous snapshot, and merges it into the current branch with a normal 3-way merge, so the
# copy stays byte-identical to upstream and Timely's few edits survive. Plan section 10.
#
#   make hermes-sync [HERMES_REF=v0.23.1]   newest stable vX.Y.Z when HERMES_REF is unset
#
# Env: HERMES_REF, HERMES_UPSTREAM_URL, HERMES_GH_REPO, HERMES_CACHE (bare upstream cache),
#      HERMES_ALLOW_NON_DESCENDANT=1 (accept a release that does not descend from the last import),
#      HERMES_SKIP_RELEASE_API=1 (no `gh`; recorded as skipped in the report and tags.json).
# Exit: 0 merged or already up to date, 1 refused, 2 merge conflicts left to resolve.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
URL=${HERMES_UPSTREAM_URL:-https://github.com/NousResearch/hermes-agent.git}
GH_REPO=${HERMES_GH_REPO:-NousResearch/hermes-agent}
CACHE=${HERMES_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/timely/hermes-upstream.git}
PREFIX=apps/agent/hermes
SYNC_DIR=apps/agent/.hermes-sync
HELPERS="$REPO_ROOT/scripts/hermes-sync"
STABLE='^v[0-9]{1,3}\.[0-9]+\.[0-9]+$'

die() { echo "sync-hermes: $*" >&2; exit 1; }
g() { git -C "$REPO_ROOT" "$@"; }
up() { git --git-dir="$CACHE" "$@"; }

case "$CACHE/" in "$HOME/.hermes/"*) die "HERMES_CACHE must not live under ~/.hermes" ;; esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# 0. Clean tree, on a branch, no merge in progress.
[[ -z $(g status --porcelain --untracked-files=no) ]] || die "tracked files have changes; commit them first"
[[ -z $(g ls-files --others --exclude-standard -- "$PREFIX") ]] || die "untracked files under $PREFIX; remove them first"
g rev-parse -q --verify MERGE_HEAD >/dev/null && die "a merge is in progress; finish or abort it first"
branch=$(g symbolic-ref --quiet --short HEAD) || die "detached HEAD; check out a feature/ or fix/ branch"
[[ $branch == main ]] && die "never sync on main; branch from dev"
[[ $branch == dev || $branch =~ ^(feature|fix)/ ]] || die "sync on dev (a fix/hermes-sync-<tag> branch is made) or on a feature/ or fix/ branch, not $branch"

# 1. Which release.
REF=${HERMES_REF:-}
if [[ -z $REF ]]; then
  REF=$(git ls-remote --tags --refs "$URL" 'v*' | sed 's#.*refs/tags/##' | grep -E "$STABLE" | sort -V | tail -n1)
  [[ -n $REF ]] || die "no stable vX.Y.Z tag found at $URL"
fi
[[ $REF =~ $STABLE ]] || die "HERMES_REF=$REF is not a stable release tag (vX.Y.Z)"

# 2. Shallow fetch into the persistent bare cache (never ~/.hermes).
if [[ ! -d $CACHE ]]; then
  mkdir -p "$(dirname "$CACHE")"
  git init -q --bare "$CACHE"
fi
up fetch -q --depth=1 --no-tags "$URL" "+refs/tags/$REF:refs/tags/$REF" || die "cannot fetch $REF from $URL"
commit=$(up rev-parse --verify "refs/tags/$REF^{commit}")
committed=$(up log -1 --format=%cI "$commit")
tag_body_commit=""
if [[ $(up cat-file -t "refs/tags/$REF") == tag ]]; then
  up cat-file tag "refs/tags/$REF" | sed '1,/^$/d' >"$tmp/tag-body"
  tag_body_commit=$(python3 -I -B -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("commit", ""))
except Exception: print("")' "$tmp/tag-body")
fi

# 3. The previous snapshot, and the link from HEAD to it: the newest real snapshot (a rebase
# replays one onto a Timely commit with its message intact: merging against that would delete
# every Timely file) whose HERMES_UPSTREAM.json matches HEAD's (check_lib.py previous-snapshot).
prev=$(python3 -I -B "$HELPERS/check_lib.py" previous-snapshot "$REPO_ROOT") ||
  die "HEAD is not linked to a real Hermes snapshot (reason and recovery above)"
prev_commit="" prev_tag=""
if [[ -n $prev ]]; then
  prev_commit=$(g log -1 --format='%(trailers:key=Hermes-Commit,valueonly)' "$prev" | head -n1)
  prev_tag=$(g log -1 --format='%(trailers:key=Hermes-Tag,valueonly)' "$prev" | head -n1)
fi

# 1b. Verify the tag: release API, tags.json, ancestry. Hermes tags are unsigned and can move.
release_api="skipped (HERMES_SKIP_RELEASE_API=1)"
if [[ -z ${HERMES_SKIP_RELEASE_API:-} ]]; then
  command -v gh >/dev/null || die "gh is needed to check $REF against the GitHub releases API (or set HERMES_SKIP_RELEASE_API=1)"
  rel=$(gh api "repos/$GH_REPO/releases/tags/$REF" --jq '[.target_commitish, .draft, .prerelease] | @tsv') ||
    die "the GitHub releases API has no release for $REF"
  IFS=$'\t' read -r target draft prerelease <<<"$rel"
  [[ $draft == false && $prerelease == false ]] || die "$REF is a draft or prerelease on GitHub"
  if [[ $target =~ ^[0-9a-f]{40}$ ]]; then
    [[ $target == "$commit" ]] || die "$REF resolves to $commit but the GitHub release targets $target"
    release_api=$target
  else
    release_api="target_commitish is '$target' (a branch, not compared)"
  fi
fi
[[ -z $tag_body_commit || $tag_body_commit == "$commit" ]] ||
  die "$REF resolves to $commit but its tag body names commit $tag_body_commit"
known=$({ g show "HEAD:$SYNC_DIR/tags.json" 2>/dev/null || echo "{}"; } | python3 -I -B -c 'import json,sys
try: print(json.load(sys.stdin).get(sys.argv[1], {}).get("commit", ""))
except Exception: print("")' "$REF")
if [[ -n $known ]]; then
  [[ $known == "$commit" ]] || die "$REF now points at $commit, but $SYNC_DIR/tags.json recorded $known when Timely imported it; the tag moved"
  tags_check="matches tags.json ($known)"
else
  tags_check="new tag, not in tags.json yet"
fi
# The linked snapshot's trailers are a second record of the tag, which a rebase cannot drop.
[[ -z $prev_tag || $prev_tag != "$REF" || $prev_commit == "$commit" ]] ||
  die "$REF now points at $commit, but the linked snapshot $prev imported it from $prev_commit; the tag moved"
ancestry="first import"
if [[ -n $prev_commit && $prev_commit == "$commit" ]]; then
  ancestry="same upstream commit as the last import"
elif [[ -n $prev_commit ]]; then
  if ! up cat-file -e "$prev_commit^{commit}" 2>/dev/null; then
    up fetch -q --depth=1 --no-tags "$URL" "$prev_commit" || true
  fi
  if ! up merge-base --is-ancestor "$prev_commit" "$commit" 2>/dev/null; then
    since=$(g show "$prev:$PREFIX/HERMES_UPSTREAM.json" | python3 -I -B -c 'import datetime,json,sys
d = datetime.datetime.fromisoformat(json.load(sys.stdin)["committed"]) - datetime.timedelta(days=2)
print(d.strftime("%Y-%m-%d"))')
    up fetch -q --no-tags --shallow-since="$since" "$URL" "+refs/tags/$REF:refs/tags/$REF" || true
  fi
  if up merge-base --is-ancestor "$prev_commit" "$commit" 2>/dev/null; then
    ancestry="descends from $prev_tag ($prev_commit)"
  elif [[ -n ${HERMES_ALLOW_NON_DESCENDANT:-} ]]; then
    ancestry="NOT a descendant of $prev_tag ($prev_commit); allowed by HERMES_ALLOW_NON_DESCENDANT=1"
  else
    die "$REF ($commit) does not descend from the last import $prev_tag ($prev_commit); set HERMES_ALLOW_NON_DESCENDANT=1 to import it anyway"
  fi
fi

# 4. The filter, from the committed HEAD copy.
filter_sha=$(g rev-parse -q --verify "HEAD:$SYNC_DIR/filter") || die "commit $SYNC_DIR/filter first"
g show "HEAD:$SYNC_DIR/filter" >"$tmp/filter"

# 5. Snapshot tree (plumbing only). The record names the canonical upstream whatever URL was
# fetched from (a mirror, SSH or a local cache), so the same tag snapshots to the same tree.
start=$SECONDS
tree=$(python3 -I -B "$HELPERS/snapshot.py" --cache "$CACHE" --repo "$(g rev-parse --absolute-git-dir)" \
  --commit "$commit" --tag "$REF" --committed "$committed" --filter "$tmp/filter" --filter-sha1 "$filter_sha" \
  --prefix "$PREFIX" --index "$tmp/index" --url "https://github.com/$GH_REPO" --stats-out "$tmp/stats.json")
if [[ -n $prev && $tree == $(g rev-parse "$prev^{tree}") ]]; then
  # Same tree, so the same tag and commit as the linked snapshot. tags.json can still lack it: a
  # rebase drops the `hermes: sync` merge that recorded it, and the documented recovery (relink,
  # then re-run) lands here. Record it again in its own commit. ($known is empty only then; a
  # recorded commit that differs was refused in step 1b.)
  if [[ -z $known ]]; then
    [[ $branch == dev ]] && die "$SYNC_DIR/tags.json on dev has no entry for $REF; record it on a fix/ branch (re-run the sync there)"
    mkdir -p "$REPO_ROOT/$SYNC_DIR"
    python3 -I -B "$HELPERS/record_tag.py" "$REPO_ROOT/$SYNC_DIR/tags.json" "$REF" "$commit" "$committed" "$release_api"
    g add "$SYNC_DIR/tags.json"
    g commit -q -m "hermes: record $REF in tags.json" -m "The linked snapshot $prev imported $REF ($commit); the commit that recorded it is gone (a rebase?)."
    echo "Recorded $REF ($commit) in $SYNC_DIR/tags.json: the commit that recorded it was gone (a rebase?)"
  fi
  echo "Hermes $REF is already up to date ($commit, snapshot $prev)"
  exit 0
fi

# 0 (cont.). Branch first when on dev (repo rule: feature/ or fix/ branches only). Refuse when an
# earlier attempt left fix/hermes-sync-<tag> behind; checked only now, so a branch left over from
# a sync already merged into dev never hides "already up to date". Nothing is committed yet (the
# snapshot's objects are only in the object store).
if [[ $branch == dev ]] && g show-ref --verify --quiet "refs/heads/fix/hermes-sync-$REF"; then
  die "branch fix/hermes-sync-$REF already exists (an earlier sync attempt?): switch to it and re-run there, or delete it"
fi
if [[ $branch == dev ]]; then
  g switch -q -c "fix/hermes-sync-$REF"
  branch="fix/hermes-sync-$REF"
  echo "Created branch $branch"
fi

# 6. Snapshot commit, parented on the previous snapshot.
new=$(g commit-tree "$tree" ${prev:+-p "$prev"} -m "hermes: snapshot $REF" -m "Hermes-Tag: $REF
Hermes-Commit: $commit
Filter-Sha1: $filter_sha")
# Local convenience ref outside refs/heads: never a branch anyone checks out (or syncs on). Shared by
# every worktree of this clone and moved by every sync (even one that later conflicts), so it is
# a hint, never the recovery's source of truth.
g update-ref -m "hermes-sync $REF" refs/hermes/vendor "$new"
# The per-tag ref no other tag's sync moves, with a reflog (refs/hermes/* keeps none by default), so
# the rebase recovery still finds this snapshot after other syncs (snapshot-of.sh reads it).
g update-ref --create-reflog -m "hermes-sync $REF" "refs/hermes/snapshots/$REF" "$new"

# 7. Report (also the PR body).
report=$(g rev-parse --path-format=absolute --git-path hermes-sync-report.md)
python3 -I -B -c 'import json,sys
json.dump(dict(zip(["tag","commit","tag_body_commit","release_api","tags_check","ancestry","prev_tag","prev_commit"], sys.argv[1:])), sys.stdout)' \
  "$REF" "$commit" "$tag_body_commit" "$release_api" "$tags_check" "$ancestry" "$prev_tag" "$prev_commit" >"$tmp/verify.json"
python3 -I -B "$HELPERS/report.py" --repo "$REPO_ROOT" --old "$prev" --new "$new" --head HEAD --prefix "$PREFIX" \
  --sync-dir "$SYNC_DIR" --verify "$tmp/verify.json" >"$report"

# 8. Merge with a merge commit; record the tag in tags.json inside the same commit.
# -m: git keeps the message in MERGE_MSG under --no-commit, so a conflicted sync committed by hand
# is titled `hermes: sync <tag>` too (the recovery text finds snapshots by that title).
merge_args=(--no-ff --no-commit -q -m "hermes: sync $REF")
[[ -z $prev ]] && merge_args+=(--allow-unrelated-histories)
conflicted=0
g merge "${merge_args[@]}" "$new" || conflicted=1
mkdir -p "$REPO_ROOT/$SYNC_DIR"
python3 -I -B "$HELPERS/record_tag.py" "$REPO_ROOT/$SYNC_DIR/tags.json" "$REF" "$commit" "$committed" "$release_api"
g add "$SYNC_DIR/tags.json"
elapsed=$((SECONDS - start))

if ((conflicted)); then
  cat >&2 <<EOF

Merge conflicts in the files listed above. Resolve them (apps/agent/AGENTS.md, "Syncing Hermes"):
  - patch point: take upstream, re-apply the change listed in $SYNC_DIR/patches.md, keep the TIMELY(Pn) marker
  - modify/delete: restore the file and disable it by config or policy instead
  - $PREFIX/HERMES_UPSTREAM.json: always take theirs (git checkout --theirs)
Then: git add <files> && git commit --no-edit (keeps the title "hermes: sync $REF"), read $report, and run make hermes-sync-check.
EOF
  exit 2
fi
g commit -q -m "hermes: sync $REF"

# 9. Next steps.
echo "Next: read $report (it is also the PR body), triage new tools, skills, deps and seams, run make hermes-sync-check, then open a PR and merge it with a merge commit (never squash or rebase)."
echo "Hermes $REF ($commit) merged into $branch in ${elapsed}s: $(python3 -I -B -c 'import json,sys; s=json.load(open(sys.argv[1])); print(f"{s["files"]} files, {s["bytes"]/1048576:.1f} MiB")' "$tmp/stats.json"), snapshot $new"
