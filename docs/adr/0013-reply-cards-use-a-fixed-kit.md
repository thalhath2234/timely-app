# Reply cards are drawn from a fixed kit, not model-written UI

An agent reply may end with one ```openui-lang fence: a short OpenUI Lang
program (https://openui.com, MIT) that names components from one shared list
in `packages/contract/src/genui.ts`. Web, desktop and phone each register their
own renderer for every name, so a Reply card looks like the rest of Timely
on each app and the model never writes HTML, JSX, styles or code that runs.
A name or prop outside the list is dropped, and a program that fails to parse
leaves the text and one muted line. We chose this over model-written HTML in
a sandbox (off-brand, unsafe to make interactive) and over JSON tool output
(more tokens, poor partial results).

The model's instructions are generated from the same list (`make
gen-genui-prompt`) and checked by `make test-genui`, so the prompt and the
renderers cannot drift. Apps send `ui: "openui-1"` with each message; the API
adds the instructions only to conversations whose latest message came from
an app that draws cards, so older builds and outside agents keep plain text.

Cards are a view, never a write path: they show only data the agent read
with tools in the conversation, a tick in a task row is the person's own
action through the normal task update, and an answer chip only sends a
message. Every change the agent makes still follows ADR 0007. Cards carry ids
for live data, so a task row shows the task as it is now rather than as the
agent saw it. Install telemetry in the OpenUI packages stays off
(`allowBuilds: false`) and their devtools never mount.
