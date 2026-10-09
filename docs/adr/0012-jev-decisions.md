# Smart suggestions run on Jev through one decision service, and only suggest

- Status: Accepted
- Date: 2026-10-09

Timely asks small typed questions ("Is this Work or a Reminder?", "How much effort does this take?", "Is this the same task as that one?") of Jev, TypeSafe's decision model, instead of a chat model. Jev answers a Choice, a Score or a yes/no with a confidence, in well under a second, which fits places where a chat model is too slow or too costly: the Clarify form, the agent's default work length, and later the scheduler and notifications.

**One service in the API.** `internal/features/decide` is the only code that talks to Jev. Features build questions with `decide.Choice`, `decide.Score` and `decide.YesNo` and read answers with a minimum confidence (`Prefill` 0.6, `Route` 0.8, `Flag` 0.5). Below the threshold a feature behaves as if Jev had said nothing. The service shuffles choice options and can ask a question twice in reversed order (`Twice`), treating disagreement as zero confidence, to blunt Jev's first-option bias. It caches identical requests for ten minutes, caps parallel calls per account, keeps state under 32 KB, and logs one `decision_log` row per call (feature, provider, latency, whether the person kept the suggestion) without the text. Rows older than 30 days are pruned.

**Keys are per account, TypeSafe first.** A TypeSafe key saved in Settings → Agent is used first. On a 401, 429, 529, 5xx or network error the same request goes to OpenRouter's Decisions API (`typesafe/jev-1.13`) with the account's existing OpenRouter key; TypeSafe is Jev's only provider there, so no other company sees the request; a 422 is the request's fault and does not fall back. A 401 marks the TypeSafe key as refused until it is replaced, so later calls go straight to OpenRouter. With neither key, or with the switch off, every feature returns nothing and the app works exactly as it did before. A call that fails is logged by the API and named in the Clarify form, and Settings → Agent has a Test button that makes one live call.

**Suggest, never act.** Jev output only pre-fills fields the person has not touched, adds hints, or picks a default the person can change before saving (for example the agent's estimate for new Work). Nothing is created, moved or deleted because Jev said so. Dates, numbers and counts are never read from Jev (it is weak at them); it picks a bucket in words and code maps the bucket to a value.

## Considered Options

- **Use the chat model for these questions**: rejected; a chat round trip is seconds and tokens for what is a one-word answer, and its output needs parsing.
- **Let each feature call Jev itself**: rejected; key order, fallback, caching, rate limits and logging would be repeated and drift.
- **Auto-apply high-confidence answers**: rejected for now; a wrong silent change costs more trust than a pre-filled field saves, and the feedback log is what would justify any later change.
- **A server-wide Jev key in `.env`**: rejected; keys follow the per-account model of ADR 0009.
