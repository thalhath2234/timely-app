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
| `web_extract` | `{urls: [url, ...]}` | `{result: {pages: [{url, title, content, error}]}, outside: true}` | one entry per requested URL in request order (matched by `url`, else by position): `{url, title, content, raw_content, metadata}`, or `{url, title, content, error}` for a page with `error`; a URL Go left out gets "Timely returned no page for this link" |
| either | | `{result: {error: text}}` | `{success: false, error}` (search) or every URL failed with `error` (extract) |

An `outside: true` answer adds `{kind: "web", tool}` to the run's taint (`RunContext.tool_call`). `timely_gate` also reports `{kind: "web", tool: "web_extract", host}` for each host a `web_extract` that ran named (any backend), so a `direct=true` proposal after it carries the host and Go holds it for review.

Hermes' controls stay in front of the provider: a URL carrying a secret is refused, the SSRF floor (`security.allow_private_urls: false`) resolves each extract URL's host before the provider is asked (the only name lookup the worker makes for this backend), redirect targets are re-checked, results are truncated, and search answers are memoised per worker (one account) and pages cached in the account home. Go applies `flags.web` first (`gate.ask`: "Web search is off in this chat" when the toggle is off, in Sensitive and answer-only turns) and, as a second line, refuses an extract to a host outside `person_hosts` and the run's search results once the chat is tainted.

## The exfiltration rule (`timely_gate`, `plugins/timely_gate/egress.py`)

Phase 3 blocks (no approval path until phase 5). It runs in `timely_gate`'s `pre_tool_call` before Go is asked, so a blocked call never reaches Go. A clean session (no taint yet) is not restricted beyond the SSRF floor. Once the session is tainted (any taint source ran, a Timely tool answered `outside: true`, or `run.start.tainted_sources` was non-empty):

1. **`web_extract` and `browser_*` URLs**: every URL's host must be a host the person typed in this chat (`run.start.person_hosts`) or one a `web_search` in this conversation returned (this run's results, from `post_tool_call`, and earlier turns' results, read from the session's `state.db` transcript once per run). Otherwise: "Blocked: this chat has read outside content, and `<host>` is not a site the person named or one a web search in this chat returned. Paste the link yourself if you want me to open it." One bad URL blocks the whole call; a URL without a host is blocked.
2. **`web_extract` URL text**: a URL to an allowed host is still blocked when its path, query or fragment (decoded) carries text from a Timely read or from memory, unless a search returned that exact URL ("this link carries text from the person's Timely data or memory ... Paste the link yourself if you want me to open it."). An injected page could otherwise get its own host into the search results first.
3. **`web_search` query**: blocked when it carries text from a Timely read (any Timely tool's result in this conversation except `propose_changes`; a past-chat search hit; Timely's paragraphs of this turn's message, `run.start.private_context`, and of stored turns, the paragraphs that start with one of `egress.NOTICE_PREFIXES`: the get_context result, attached context, tag, image and change notices), memory (`MEMORY.md` and `USER.md`, each entry and each file whole), or a tainted tool result other than `web_search`/`web_extract` (MCP, files, terminal, browser ...): "Blocked: this search would send text from the person's Timely data or memory to the web, and this chat has read outside content. Search for it yourself. Paste the link yourself if you want me to open it." Web pages and search results are left out of this corpus: they are public text already, and refining a search with them leaks nothing. The person's own words are left out too: "search for X" stays a search for X.
4. **`web_search` naming another site**: blocked when the query names a site by link (`https://host`, `//host`), `site:host` or `host/path` that is neither in `person_hosts` nor returned by a search ("this search names `<host>`, which is not a site the person named ..."): a provider's own search (Codex's live search) may open what a query names. A bare name such as `node.js` is a word, not an address.

Go repeats a second line for the `timely` backend (`chat/web.go` `mayOpen`, `searchNamesOtherSite`): after taint a page opens only when a search returned it word for word, the person typed it (path and query as typed), a Bot reads it, or it is the front page of a typed or searched site; a search naming another site is refused.

Documents longer than 50,000 characters are kept as overlapping pieces, so nothing past the first piece escapes the match.

Hosts are compared lowercase, without a trailing dot or a leading `www.`, exactly: a subdomain of an allowed host is another host.

Text matching (`egress.carries`), per document (one tool result, one memory entry or one memory file), any of:

| Check | Rule |
| --- | --- |
| Tokens | lowercase `\w+` runs (Unicode). A **distinctive** token has 4 or more characters or contains a digit, and is not a stopword (`egress.STOPWORDS`). |
| Run | 4 consecutive query tokens appear consecutively in the document, at least 2 of them distinctive. |
| Whole query | the normalised query (lowercase, single spaces; at least 16 characters and 2 distinctive tokens) is a substring of the normalised document. |
| Overlap | at least 3 of the query's distinctive tokens occur in the document, and they are at least half of them. |
| Rare token | a token over `[\w@.+-]` of 6 or more characters containing a digit or `@` (phone and account numbers, emails), not a date or time, occurs in both. |

Each document is cut at 50,000 characters and the 64 newest of each kind are kept per conversation; at most 256 conversations are remembered per worker (the transcript is re-read each run). A check that fails for any reason blocks the call.

Residuals: what a lookup reveals (the SSRF floor resolves each allowed extract host), text paraphrased past the token rules, and URLs built at run time inside `browser_exec` code (plan 14).
