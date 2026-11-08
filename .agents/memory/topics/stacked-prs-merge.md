---
name: stacked-prs-merge
description: GitHub API won't merge or retarget PRs in a stack; threads can't push to dev; user must click Merge
metadata:
  type: feedback
  modified: 2026-10-08T03:58:49.292Z
---

On 2026-10-08 the user asked to merge the docs PRs (#90, #91, #92, stacked) into dev. GitHub treats PRs whose base is another PR's branch as a "stack": the merge API returns 403 "Merging stacked PRs via this endpoint is not supported", and changing the base is refused. Fast-forwarding each lower branch to the top head marked #92 and #91 as merged and folded everything into #90, but #90 still could not be merged by API, and a direct push to dev is blocked by the session permission classifier ("Merge Without Review").

**Why:** Claude can't finish a merge to dev on its own in this setup.
**How to apply:** Avoid stacking PRs when the user may want Claude to merge; base follow-ups on dev or fold them into the open PR. When a merge is asked for, expect the user to click Merge on GitHub. Related: [release-flow](release-flow.md).
