# Chat prefers a dedicated provider over OpenRouter

An account's OpenRouter key does three jobs: semantic-search embeddings, smart
suggestions (Jev through OpenRouter's decisions endpoint) and, optionally,
chat. Until now every account started with OpenRouter as its default provider,
and disconnecting the default fell back to it. So a person who saved an
OpenRouter key for search and an Anthropic key for chat still had chat, Help
me write, task offers, view queries, dashboard cards and live blocks run on
OpenRouter's chat model, without ever choosing it.

The default provider is now empty until the person picks one. While it is
empty, runs and the writing features use the first provider the person set up
in this order: direct API keys (registry order, so Anthropic leads), then a
connected Claude Code or Codex CLI, then OpenRouter. The pick reads saved
settings only, so a run never waits on a CLI check, and a provider that is set
up but not ready right now (signed out, no model) keeps the pick: its run fails
with its own message instead of moving to OpenRouter. An OpenRouter-only
account keeps working; adding any other provider moves chat to it, since adding
that key is the person's choice of where their data goes (ADR 0009). Removing
or disconnecting the chosen default, OpenRouter included, empties it again. The
writing features follow exactly the provider chat uses, so the two never
disagree, and a live block written from a chat is described by that chat's own
model.

Saving an OpenRouter key is checked with OpenRouter's key endpoint, which
spends no tokens, so a key meant for search never runs a chat model; a key
whose own credit limit is spent is refused there. Its chat model is tested when
OpenRouter becomes the chosen default, and a changed chat model is tested only
while OpenRouter runs chat. A new Anthropic key starts on Haiku, the cheapest
current model (another listed Haiku, else Sonnet, never the most capable model
first), as does the Claude Code CLI. A replaced key keeps its model when the
fresh list names it with a date or "latest"; a shorter or longer id is a
different model and is never taken for it.

Existing accounts stored `openrouter` through the old column default, so the
migration empties every `openrouter` default. Someone who had picked OpenRouter
over another connected provider presses "Use as default" on it once more.
Anthropic keys saved before this change were given Opus automatically; the
migration moves those to Haiku unless the account had chosen Anthropic as its
default, since those accounts start running chat on Anthropic only now.
