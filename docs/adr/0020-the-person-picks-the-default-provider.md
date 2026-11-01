# The person picks the default provider

ADR 0019 left the default provider empty until the person picks one, and ran
everything on the first provider set up in the meantime ("Automatic"). The
owner decided against that pick: an account with only an Anthropic key ran on
Anthropic without anyone choosing it, and removing the default quietly moved
work to whatever came next. Choosing where an account's data goes is the
person's call (ADR 0009), so Timely no longer makes it for them.

No provider becomes the default on its own. While none is chosen, the features
that run on the default provider wait: new chat runs that did not pick their
own model, Help me write, checklist task offers, view queries, dashboard cards
and live blocks (Describe, and `add_live_block` through MCP). They fail with
one typed error, HTTP 409 with `{"code": "provider_not_chosen"}` (a failed chat
carries the same `errorCode`), and the apps answer it with a button to
Settings → Agent. A chat whose own model was picked keeps working, and Jev and
embeddings are not chat providers, so they are unaffected. An account with
nothing set up still hears "add a key"; the order ADR 0019 used for the pick
now only tells those two cases apart.

The apps ask instead of picking. Saving a key, or connecting a CLI or Ollama,
while nothing is chosen asks in the same step which set-up provider runs new
chats and Help me write, with the one just saved selected. Removing or
disconnecting the chosen default asks which of the remaining providers takes
its place, in the same confirmation; with nothing else set up, nothing is
asked. Both use one picker. The Default provider row in Settings reads "Not
chosen" while empty and has no Automatic option. Removal through the API or
MCP, with no person to ask, empties the default, and the features above then
wait for a pick.

There is no migration: accounts that relied on Automatic see the error once,
and Settings → Agent shows the picker. Choosing a provider test-calls its saved
model, so an Anthropic pick stays on Haiku, as ADR 0019 set.

This supersedes the Automatic pick in ADR 0019; its other decisions stand.
