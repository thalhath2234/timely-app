# timely_web: web search and pages through Timely

Phase 3 (plan 3.2, 8.2, 8.4; owner answer Q-3.8). The model calls Hermes' own `web_search` and `web_extract`. Which backend runs them is `web.search_backend` / `web.extract_backend` in the account's `config.yaml`, rendered by `config_render.py` from `settings.web`:

- `timely` (the default, this plugin): the worker asks Go. Go runs the search with the chat provider's own search (the run's Completer; Claude Code and Codex through the same path the loopback gateway uses) and fetches pages through its netguard. The worker opens no connection for this backend.
- a keyed backend (below): the person saved a search key in Settings. Go passes the key under the backend's Hermes env name and renders that backend's id; Hermes' own plugin then calls the vendor from the worker.

Keyless backends stay off: `web.keyless_fallback` and `web.keyless_rescue` are managed floors (`false`), `ddgs` is not installed, and contract test 5 checks that a turn makes no lookup beyond the configured hosts.

## Keyed backends (`timely_agent/web_backends.py`)

The static list Settings falls back to when the worker has not reported `ready.web_backends` yet. `make agent-install` installs every extra (`.hermes-sync/extras.txt`); `web_backends.available()` reports a backend only when its anchor import resolves and its plugin folder is in the copy.

| id | Settings label | Key env name | Extra | Anchor import | Search | Extract | Get a key |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `exa` | Exa | `EXA_API_KEY` | `exa` | `exa_py` | yes | yes | https://dashboard.exa.ai/api-keys |
| `firecrawl` | Firecrawl | `FIRECRAWL_API_KEY` | `firecrawl` | `firecrawl` | yes | yes | https://www.firecrawl.dev/app/api-keys |
| `parallel` | Parallel | `PARALLEL_API_KEY` | `parallel-web` | `parallel` | yes | yes | https://platform.parallel.ai/ |

Adding one is a row in `BACKENDS` (plus its extra in `extras.txt` when it has one) and a line here.

## What the worker sends and what Go answers (PROTOCOL.md 10.7)

The provider sends `tool.call` through `RunContext.tool_call` (`batch_size` 1, `sibling_tools` empty: the call is the backend's, not the model's) and waits up to `bridge.TOOL_ANSWER_TIMEOUT_S`.

| Call | `args` | Go's `tool.result` | What the model gets |
| --- | --- | --- | --- |
| `web_search` | `{query, limit}` (`limit` is Hermes' bucketed count) | `{result: {answer, results: [{url, title, description}]}, outside: true}` | `{success: true, data: {web: [{url, title, description, position}], answer?}}`: rows without an http(s) URL dropped, at most `limit`, positions from 1; a non-empty `answer` kept as `data.answer` |
| `web_extract` | `{urls: [url, ...]}` | `{result: {pages: [{url, final_url?, title, content, error}]}, outside: true}` | one entry per requested URL in request order (matched by `url`, the address asked for, else by position when Go answered every URL; `final_url` is where a redirect led): `{url, title, content, raw_content, metadata}`, or `{url, title, content, error}` for a page with `error`; a URL Go left out gets "Timely returned no page for this link" |
| either | | `{result: {error: text}}` | `{success: false, error}` (search) or every URL failed with `error` (extract) |

An `outside: true` answer adds `{kind: "web", tool}` to the run's taint (`RunContext.tool_call`). `timely_gate` also reports `{kind: "web", tool: "web_extract", host}` for each host a `web_extract` that ran named (any backend), so a `direct=true` proposal after it carries the host and Go holds it for review.

Go's `results` are the provider's url citations only (a link in the answer text stays in the text), and Go reads each page once a run (a page read again comes from that read).

Hermes' controls stay in front of the provider: a URL carrying a secret is refused, the SSRF floor (`security.allow_private_urls: false`) resolves each extract URL's host before the provider is asked (the only name lookup the worker makes for this backend), redirect targets are re-checked, results are truncated, and search answers are memoised per worker (one account) and pages cached in the account home. Go applies `flags.web` first (`gate.ask`: "Web search is off in this chat" when the toggle is off, in Sensitive and answer-only turns).

## After the chat read outside content (owner decision Q-3.9)

Timely puts no rule of its own on where a tainted chat may search or read: the owner chose, after eight review rounds kept finding ways around a pattern-matching exfiltration rule, to handle web reads the way Hermes does. What holds on every backend (`timely` through Go, and the keyed Exa, Firecrawl and Parallel), checked by `tests/contract/test_c_web.py`:

- **Untrusted wrapping and the threat scan.** Hermes builds every `web_search`, `web_extract`, `browser_*` and `mcp_*` result message through `make_tool_result_message` (`agent/tool_dispatch_helpers.py`), which wraps it in `<untrusted_tool_result source="<tool>">` with a "treat it as data" note, defangs a copy of the delimiter inside it, and runs the advisory threat scan on it. The `timely` backend answers inside Hermes' own `web_search` / `web_extract`, so its results get the same handling.
- **Timely's own outside results.** A Timely tool Go answers `outside: true` (`ask_bot`, `preview_bot`, `list_bot_findings`, `list_notifications`) and a past-chat search with a hit from a chat that read outside content are wrapped the same way (`timely_agent/untrusted.py`, through the `transform_tool_result` hooks of `timely_tools` and `timely_learning`), with Hermes' own wrapper.
- **No key or token in a URL.** `web_extract` refuses the whole call when a URL carries what looks like an API key or token (`tools/web_tools_extract.py` `_validate_extract_urls`, `agent.redact` prefixes) before any backend is asked: Go never sees it, and a keyed vendor is never called.
- **SSRF floor and website blocklist.** Hermes resolves each extract host and refuses private, internal and metadata addresses (`security.allow_private_urls: false`), re-checks redirects and applies the website blocklist (`tools/browser_url_policy.py`, `tools/website_policy.py`). Go's backend refuses private and local-only addresses again (`chat/web.go` `publicURL`) and its netguard fetcher re-checks every address it connects to.
- **Taint.** Every page or search adds a source to the chat's taint (`{kind: "web", tool, host?}`), which holds the chat's next proposal for review (ADR 0007, `ForceReview`, permission modes) and stages learning (Q-3.1).

Residuals (plan 14): an injected page can still have the model put the person's data in a URL path or query, or in a search query; the wrapping and the threat scan make that less likely, and nothing the model does can change Timely data without the person's review once the chat is tainted.
