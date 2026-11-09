"""Record an imported Hermes tag in tags.json (sync-hermes.sh step 8, and its up-to-date branch
when a rebase dropped the commit that recorded the linked snapshot's tag).

    python3 -I -B record_tag.py <tags.json> <tag> <commit> <committed> <releaseApi>

A re-import of the same tag at the same commit with the release API skipped (a filter
re-snapshot) keeps the release-API commit already recorded: a skipped check never erases one
that passed.
"""
import json
import os
import sys

SKIPPED = "skipped"


def record(tags: dict, tag: str, commit: str, committed: str, api: str) -> dict:
    old = tags.get(tag) or {}
    if api.startswith(SKIPPED) and old.get("commit") == commit and old.get("releaseApi") \
            and not str(old["releaseApi"]).startswith(SKIPPED):
        api = old["releaseApi"]
    tags = dict(tags)
    tags[tag] = {"commit": commit, "committed": committed, "releaseApi": api}
    return dict(sorted(tags.items(), key=lambda kv: [int(x) for x in kv[0][1:].split(".")]))


def main(argv):
    path, tag, commit, committed, api = argv[1:6]
    tags = {}
    if os.path.exists(path):
        with open(path) as fh:
            tags = json.load(fh)
    with open(path, "w") as fh:
        json.dump(record(tags, tag, commit, committed, api), fh, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main(sys.argv)
