# Agent engine: question cards, sub-tasks and CLI providers

On the New engine a chat's run can stop and ask the person one to five questions on a card (Q-4.3). The run waits on the card, and the chat reads "Needs your answer". The person answers on the card or by typing in the composer, or skips. The same run then goes on from where it stopped. Stop, Delete, a lost worker and the time limit each close the card. The run can also hand work to sub-tasks, which show as "Sub-task: …" activity lines. When a sub-task reads an outside page, the chat counts as having read it, so the run's next change waits for review even in Auto. Accounts on Claude Code or Codex run on the New engine through the API's loopback model gateway.

## Sub-features

- `ask-answer`: a card with choices; `Send answer`; the closed card reads `Answered` and the same run goes on (its proposal names the same `agentRun` as the card).
- `ask-multi`: one card with a multi-select, a single-choice and an open question.
- `ask-typed`: a message typed in the composer while a card waits answers every question on it (`Send as your answer`). No separate user message is added.
- `ask-skip`: `Skip` closes the card as `Skipped`, and the run goes on. The fake-worker Go tests cover it; the phase 4 end-to-end run did not drive it.
- `ask-stop`: `Stop run` while a card waits closes it as `Stopped before you answered`. A late answer gets 409.
- `ask-delete`: deleting the chat while a card waits ends the run. A late answer gets 404.
- `ask-timeout`: nobody answers. The card closes as `Not answered in time`, and the run goes on.
- `subtask-taint`: a `Sub-task: <goal>` line appears while the run works. A sub-task's page read holds the parent's `direct=true` proposal in Auto (status `approval`). The chat's taint carries `via: "subagent"`.
- `cli-new-engine`: with Claude Code or Codex as the default provider, a chat on Engine = New answers through the gateway.

## How to get to it (user POV)

- Web: `/chat`, a new chat on an account whose Settings → Agent → Engine is New. The card renders in the thread under a Timely row (`data-testid="question-card"`). A closed card is `data-testid="question-closed"` with `data-state` set to `answered`, `skipped`, `expired` or `stopped`. Sub-task lines carry `data-kind="subagent"`.
- Phone (Expo web on `:8082`): `/assistant`. The testIDs are `question-card`, `question-choice`, `question-other`, `question-type`, `question-sheet-input`, `question-sheet-done`, `question-send`, `question-skip`, `question-closed-<state>` and `activity-subagent`.
- A question push ("Timely has a question.") opens the chat.

## Driving it with browser.mjs

Preconditions:

- The stack runs the stub model, not a provider (see "Agent engine runs" in `../SKILL.md`):
  - `apps/api/scripts/agentqa/ollama_shim.py` runs on `:11435` with a phrase table.
  - The API was started with `OLLAMA_BASE_URL`, `TIMELY_AGENT_RUNTIME`, `TIMELY_AGENT_WEB_FIXTURES`, a short `TIMELY_AGENT_CLARIFY_TIMEOUT_S` (60 to 120) and `DB_SCHEMA` set.
  - For `cli-new-engine`, the API also has `CLAUDE_BIN` and `CODEX_BIN` pointing at signed-in wrappers of `apps/api/internal/features/provider/testdata/fakecli/{claude,codex}`.
- A fresh account (`$B signup-onboard`) with these fixtures, all set through the API (they are setup, not what is under test):
  - `POST /agent/providers/ollama/key {"key":"","baseUrl":""}`.
  - `PATCH /agent/providers {"defaultProvider":"ollama","models":{"ollama":"stub-model"}}`.
  - `PATCH /agent/chat-settings {"engine":"agent","chatPermission":"supervised"}`.
- The phrase table maps the person's words to a stub directive. The card is the model's `clarify` call: `SCRIPT [{"calls":[["clarify",{"questions":[{"question":"Which day suits you?","choices":["Monday","Tuesday"]}]}]]},{"calls":[["propose_changes",{…}]]},{"text":"…"}]`. A sub-task is a `delegate_task` call whose goal is another phrase in the table: `{"calls":[["delegate_task",{"tasks":[{"goal":"Read https://recipes.fixture.invalid/ and list what to buy"}]}]]}`. The child plays that phrase's own `SCRIPT`.

Steps:

- **Ask.** Send the phrase in a new chat. `GET /chats/<id>` gives `status` `running` and `question.requestId` set. The header pill and the history row read `Needs your answer`. The card shows a `Recommended` badge on the first choice and the time left.
- **Answer.** Check a choice (`--role radio --name Tuesday`), then click `Send answer`. The card becomes `Answered` with the answer under the question. The run goes on with no new `run.start`. The shim's request log (`TIMELY_SHIM_LOG`) shows the model reading Hermes' clarify result with `user_response`.
- **Stop or Delete.** `Stop run`, or the history row's `More options for <title>` → `Delete` → confirm. Then `POST /chats/<id>/answer` with the old `requestId` gets 409 (Stop) or 404 (Delete), and the shim log has no further request for that chat.
- **Timeout.** Leave the card. After the timeout, the card reads `Not answered in time`, and the next scripted reply arrives in the same run.
- **Sub-task.** Turn Web search on in an Auto chat and send the delegation phrase. While the child sleeps, the activity box shows `Sub-task: <goal>`. The run ends in `approval` with nothing written. Prove the taint with a read-only DB read of `agent_conversations.tainted_sources` (`via: "subagent"`, `child`, host): the API does not expose it.
- **CLI providers.** `POST /agent/providers/claude/connect`, then `PATCH /agent/providers {"defaultProvider":"claude","claudeModel":"sonnet"}`. A new chat's reply is the fake CLI's text, and its header reads `Claude Code · sonnet · New engine`. Do the same for Codex with `codexModel`.

## Gotchas

- Hermes' SSRF floor resolves every `web_extract` host in the worker and fails closed. `https://<name>.fixture.invalid` pages are blocked unless the API runs in a private mount namespace whose `/etc/hosts` maps those names to a public documentation address (`unshare -rm` plus `mount --bind`; nothing connects to it).
- Use `SCRIPT` directives, not `CALL <tool> <json>`. Timely adds a system notice after the person's words, so the `CALL` arguments stop being JSON and Hermes refuses them as a truncated tool call.
- Activity lines are cleared when the run ends. Give the child a `"sleep"` step to catch the sub-task line on screen.
- Claude Code's connect check runs `claude auth status --json` and Codex's runs `codex login status`. The fake CLIs answer neither, so wrap them to report signed in.
- Run the live Claude Code check on an API outside the user namespace: it runs as uid 0 there.
- A chat's taint lists a child's page read more than once: Go's own entry without `via`, then the worker's entries with `via: "subagent"`, one without a host. Match on `via` and `host` together.
- The card's time limit is per API (`TIMELY_AGENT_CLARIFY_TIMEOUT_S`, honoured only with `DB_SCHEMA` set). The default is 10 minutes.
