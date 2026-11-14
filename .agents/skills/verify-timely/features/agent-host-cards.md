# Agent engine: host cards, Undo, MCP servers and the shell token

On the New engine, a host-allowed account's chat can run commands, read and change files, run code, drive the browser and use MCP servers on the computer the API runs on. Each call is a host card that shows exactly what it would do, and nothing runs until the person answers: Run once, Allow for this chat or Deny. The run waits live for 10 minutes, then parks for up to an hour, and Run once on a parked card runs exactly that call in a continuation turn. A file change leaves "Undo this change". An MCP server set to Ask me first shows a card for each call, and Off is never offered. The host-allowed switch for an account is made in the desktop window, never by a web page.

Everything here acts on the machine that runs the stack. Follow the sandbox rules in "Gotchas" before you drive anything.

## Sub-features

- `host-run-once`: "List the files in my workspace" raises a card with the command and the working folder; Run once runs it, the output reaches the reply, and the closed card reads `Ran`.
- `host-deny`: Deny on a card for a destructive command (`rm -rf <sandbox>/p5-victim`): "Nothing ran", the model reads Hermes' refusal, no spawn.
- `host-stop`: Stop run while a card waits closes it `Stopped before you answered`, runs nothing, and a late answer gets 409.
- `host-allow-chat`: Allow for this chat on a file read; a second read in the same folder runs with no card, and the closed card reads `Allowed for this chat`.
- `host-park`: nobody answers within the live wait. The card reads `Paused: waiting for your OK` (parked), the run is gone, and Run once starts a continuation that runs the command once.
- `host-undo`: after an approved `write_file`, `Undo this change` restores the file and the card reads `Undone`.
- `host-mcp`: Settings → Agent → MCP servers adds a local command server through a card in a new "Add an MCP server" chat. A chat that calls it shows a "Use <server>?" card; Off removes the tool.
- `shell-token`: `PUT /instance/host-accounts` is 404 without the shell token, with a wrong one and through the web proxy; 200 with the token directly from loopback.
- `exit-audit`: after a drive, `agentqa -audit-host` reports zero unapproved host executions and no card holding a lease.

## How to get to it (user POV)

- Web: `/chat`. A card is `data-testid="host-card"` with `data-state` (`live`, `parked`); its buttons are `Run once`, `Allow for this chat` and `Deny`. A closed card is `data-testid="host-closed"` with `data-state` `ran`, `allowed`, `denied`, `expired` or `stopped`; `Undo this change` sits on a closed card whose call left a checkpoint.
- The header pill and the history row read `Needs your OK` (live) or `Waiting for your OK` (parked).
- Settings → Agent: `Permissions` → Host cards ("Who can approve a card": Any of my devices or Only the desktop window; "Cards wait up to": 10 minutes to 1 hour); `MCP servers` (Add a server: Catalog, An address, A command; each server's mode: Can use, Ask me first, Off).
- Settings → Server (desktop window only): "Let the assistant use this computer" and "Working folder". A browser cannot reach this tab.
- Phone (Expo web on `:8082`): `/assistant`, the chat history button (`Chat history`). testIDs `host-card`, `host-once`, `host-chat`, `host-deny`, `host-closed-<state>`, `host-undo`. Run once and Allow for this chat ask for device unlock first.

## Driving it with browser.mjs

Preconditions:

- The sandbox exists: `make agent-host-sandbox` makes `$HOME/.cache/p5-sandbox/{home,work,chrome-profile}` and prints the paths. Put a few harmless files in `work` (`notes.txt`, `todo.md`, `greeting.txt`). `make agent-host-sandbox-clean` removes it all afterwards.
- The stack from `$V up` with `VERIFY_TIMELY_SCHEMA=phase5` (or any schema), then the agent-engine API of "Agent engine runs" in `../SKILL.md` with these extra variables, all honoured only with `DB_SCHEMA` set:
  - `TIMELY_AGENT_REAL_HOME=$HOME/.cache/p5-sandbox/home`: the "real" home every command sees. The API refuses a folder outside `$HOME/.cache/p5-sandbox`.
  - `TIMELY_AGENT_HOST_LIVE_WAIT_S=120` (a few seconds for the parking check) and `TIMELY_AGENT_HOST_PARK_S=600`.
  - `TIMELY_AGENT_IDLE_MINUTES=1` so a parked card's idle worker is reaped.
  - `TIMELY_SHELL_TOKEN=<random>`: the token the desktop supervisor makes per launch. The API reads it once at start and unsets it.
- The stub model is `ollama_shim.py` with a phrase table. Host tools have shorthands, one call each, that the shim turns into a `CALL` directive and replays in a continuation turn: `TERMINAL <command>`, `READ_FILE <path>`, `WRITE_FILE <path> :: <content>`, `MCP_TOOL <server> <tool> [<json>]`. Use `SCRIPT [...]` for a run of calls (a read before an overwrite, two reads).
- A fresh account (`$B signup-onboard`) with the same setup as `agent-question-cards`, plus the account made host-allowed. Do that with the shell token, directly on the API from loopback, never through the web proxy:
  `curl -X PUT http://127.0.0.1:8081/instance/host-accounts -H "Authorization: Bearer <session token>" -H "X-Timely-Shell-Token: <the token>" -d '{"uid":"<your uid>","on":true,"workingDir":"<sandbox work>"}'`.
  The session token is `POST /login`'s `token`; the uid is its `user.id`.

Steps:

- **Shell token.** The same PUT without the header, with a wrong header, and through `http://127.0.0.1:4002/api-proxy/...` with the right header each answer 404. Directly from loopback with the right header it answers 200, and `GET /instance/settings` lists the account with `source: desktop`. Record the four codes in `shell-token-checks.txt`.
- **Run once.** Send "List the files in my workspace". `wait --testid host-card`: it reads `Run this command?`, `Needs your OK`, the command, "In <work folder>" and `Supervised asks before every action`. `click --role button --name "Run once"`, then `wait --testid host-closed`. The reply is "Done after tool: " followed by the command's output, and the closed card reads `Ran`.
- **Deny.** Send "Remove my scratch folder" (the phrase maps to `TERMINAL rm -rf <work>/p5-victim`). The card has no Allow for this chat (a delete is never grantable). `Deny`: the card closes `Denied`, "Nothing ran. The assistant was told you said no.", the reply holds `BLOCKED: Action denied by user`.
- **Stop.** Send a command, wait for the card, `click --role button --name "Stop run"`. The card closes `Stopped before you answered`, the chat is `stopped`, a late `POST /chats/<id>/host-approval` gets 409, and the command never started.
- **Allow for this chat.** Send "Read both of my notes" (a `SCRIPT` of two `read_file` calls in the work folder). Click `Allow for this chat` on the first card. The second read runs with no second card, the closed card reads `Allowed for this chat`, and the run replies.
- **Parked card and continuation.** Restart the API with `TIMELY_AGENT_HOST_LIVE_WAIT_S=12`. Send a command and leave the card. After about 12 s it reads `Paused: waiting for your OK` with the parked time left, and `GET /chats/<id>` has `hostRequest.phase` `parked`, `status` `host_approval`. `Run once`: the same command runs once and the output arrives.
- **Undo.** Send a `SCRIPT` that reads then writes a file (Hermes refuses to overwrite a file the run has not read), answer both cards Run once. The closed card for the write shows `Undo this change`. Click it: the file on disk is back to its earlier content and the card reads `Undone`.
- **MCP.** Settings → Agent → `Add a server` → radio `A command`; Name `fake`, Command `<apps/agent/.venv/bin/python>`, Arguments `-I <apps/agent/tests/contract/fake_mcp_echo.py>`; `Add and ask me`. The row reads `Waiting for your OK on the host card`. Open the "Add an MCP server" chat, `Run once` on the card (it shows the exact command): the row reads `Connected`, mode `Ask me first`. Send "Echo through the fake server": a `Use fake?` card shows `echo {"text":"hello-mcp"}`; Run once and the model reads the server's answer wrapped as untrusted data. Open the mode menu (`button "fake mode, Ask me first"`, then `option "Off"`) and send it again: the model is told the tool does not exist and no card appears.
- **Light, dark, 1440 and 390.** `$B` cannot set a viewport or colour scheme. Use a Playwright script that connects to the verify browser (`chromium.connectOverCDP("http://127.0.0.1:9339")`), calls `page.setViewportSize` and `page.emulateMedia({colorScheme})`, opens each chat by URL (`/chat?id=<id>`) and screenshots. A live card must be on screen for its shots, so use a long live wait for those.
- **Exit audit.** After the drive, with the API's DSN (`search_path` set to the schema), run `cd apps/api && go run ./scripts/agentqa -audit-host -dsn "$DSN"`. It prints the event counts and must end `PASS: zero unapproved host executions, no lease held by a card`. A failure names the chat and the call.

## Gotchas

- **Sandbox first, always.** Every command, file and "real" browser profile of a drive must live in `$HOME/.cache/p5-sandbox`. Never give the account a working folder outside it, never set `TIMELY_AGENT_REAL_HOME` to anything else, and never drive with the owner's real home, browser profile, `~/.ssh`, `~/.gitconfig` or `~/.hermes`. Only harmless commands (`ls`, `cat`, `echo`, writing a file in the sandbox). A destructive command is only ever denied, and its path is a nonexistent sandbox path. The stub drive has no exec trap (that is the Go and Python suites'), so deny is the only answer to `rm -rf`.
- Phone-width checks on the web app (390) are the desktop layout in a narrow window, not the phone app. The phone app is Expo web on `:8082`, which needs its own Metro and about 1 GB; stop Next (`web.sid`) first on a loaded machine, as the API alone serves it.
- The MCP routes need `registerAgentMCP` called in `cmd/main.go`. When `GET /agent/mcp/servers` is not 200, the Settings section shows an error; add the call in the scratch worktree, never the source checkout.
- Hermes refuses `write_file` over a file the run has not read ("Refusing to overwrite"), so a rewrite needs a read first, and that makes it two cards.
- The second card of a run reads "comes after reading outside pages" (a critical-list item) because a command's or a file's output is outside content. Such a card has no Allow for this chat, so a grant for `echo` does not survive the first command's output in the same chat. A file read in the granted folder does, because a read is not held after outside content.
- "Undo this change" appears only when Hermes took a new checkpoint for this run. A write that leaves the folder exactly as an earlier checkpoint had it creates none, so overwrite with different content than the last test.
- A parked card shows `Paused: waiting for your OK`, and the card in an "Add an MCP server" chat is parked from the start (no run waits on it). Its copy, "The assistant stopped to wait", is the same.
- A `host.ran` event for a call stopped in the worker's dispatch fence can read `ok`. The command never started: check the process list or the exec trap, not the event, for "nothing ran".
- Another account's host card, run or settings are 404 for you. The audit reads the whole schema.
