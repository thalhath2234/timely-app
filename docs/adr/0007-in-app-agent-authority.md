# In-app agent authority and partial completion

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
