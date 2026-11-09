# In-app agent authority and partial completion

> Amendment (2026-11-09, plan phase 2, behind the per-account Engine switch and
> on both engines): whether a proposal waits now depends on the chat's
> Permission mode, not on the model's own `direct` flag. In Supervised, the
> default for new chats and the mode every existing chat moved to, every
> proposal waits for Approve, so small edits that used to apply at once now
> wait. In Auto, and in Full Access, which in phase 2 lifts nothing more than
> Auto for Timely data, a proposal applies at once and shows as applied with
> Undo unless the chat is Sensitive or read outside pages, Jev added review
> notes, it edits a repeating series, a step is on the Critical list or its
> tool's own floor below asks for review, or no inverse exists to undo it.
> Writes still reach Timely data only through a proposal and the model-free
> apply, whatever the engine or mode. The per-tool floors below (no
> whole-object deletion by the agent alone, sheet removals after a preview)
> still hold in every mode.

The in-app agent immediately executes clear single-object creations and small
edits, while multi-step requests, recurring-series changes, bulk edits,
replacement of existing document content, populated sheet creation, and removal
or replacement of sheet contents require an editable Agent proposal and
approval. This balances low-friction capture against reviewing changes with wider
effects; neither universal confirmation nor unrestricted execution matches the
accepted interaction model. Initial authority covers everyday object creation
and editing plus Auto-schedule Preview/Apply, excluding whole-object deletion,
settings, backups, and restore. Explicitly requested sheet row/column removal and
sheet-data replacement are allowed after previewing affected data and obtaining
approval. This exception supports normal sheet editing without authorizing deletion
of entire sheets. Clear single-cell edits execute immediately; bulk edits require
approval.

An approved multi-step request may partially complete. Preserve successful writes,
report unfinished steps, and retry without duplicating successes, rather than
promising all-or-nothing execution or silently deleting already-created work.
