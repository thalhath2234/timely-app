"""Timely's side of Hermes' self-learning (plan section 9b, phase 3).

Hermes learns on its own: ``memory`` and ``skill_manage`` in the turn, and the learning pass
(``agent/background_review.py``) after delivery. Everything here is an adapter around it:

- ``files``     where an account home keeps memory, the skill ledger, pending writes and usage;
                plain readers, no Hermes import.
- ``rules``     the policy decision for one learning write (block, stage, allow), Q-3.1 and 9b.2.
- ``staging``   stages a write through Hermes' ``tools.write_approval.stage_write`` and remembers
                its Timely context (``.timely/pending/<id>.json``).
- ``feed``      turns changes into ``learning`` messages for Go (one per change, deduplicated).
- ``counters``  ``_iters_since_skill`` / ``_turns_since_memory`` per conversation, kept across agent
                cache evictions and worker restarts (``.timely/counters.json``).
- ``passes``    ``busy.learning`` while a learning pass or the curator runs.
- ``curator``   the maintenance tick: Hermes' curator, stale marks only (Q-3.6).
- ``api``       Go's ``learning.*`` requests and ``settings.update`` (PROTOCOL.md section 10).
"""
