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

Hermes' controls stay in front of the provider: a URL carrying a secret is refused, the SSRF floor (`security.allow_private_urls: false`) resolves each extract URL's host before the provider is asked (the only name lookup the worker makes for this backend), redirect targets are re-checked, results are truncated, and search answers are memoised per worker (one account) and pages cached in the account home. Go applies `flags.web` first (`gate.ask`: "Web search is off in this chat" when the toggle is off, in Sensitive and answer-only turns) and, as a second line, refuses an extract that `mayOpen` refuses once the chat is tainted (the worker applies the same page rule first, for every backend).

## The exfiltration rule (`timely_gate`, `plugins/timely_gate/egress.py`)

Phase 3 blocks (no approval path until phase 5). It runs in `timely_gate`'s `pre_tool_call` before Go is asked, so a blocked call never reaches Go. A clean session (no taint yet) is not restricted beyond the SSRF floor. Once the session is tainted (any taint source ran, a Timely tool answered `outside: true`, or `run.start.tainted_sources` was non-empty):

1. **`web_extract` and `browser_*` URLs**: every URL's host must be a host the person typed in this chat (`run.start.person_hosts`) or one a *clean* `web_search` in this conversation returned: a search the model asked for while the run and the chat were untainted (`pre_tool_call` notes it). This run's clean results come from `post_tool_call`; earlier turns' from `run.start.search_results`, which Go keeps per chat from the worker's `taint.search_results` (any backend) and its own `timely` backend. A search made after taint may have been asked for by an injected page, which can plant results and have them opened in an order that spells out the person's data (or put it in a result's host): its rows reach the model as text and never open. The search rows in `state.db` never count, since the transcript does not say whether the chat was tainted then. Otherwise: "Blocked: this chat has read outside content, and `<host>` is not a site the person named or one a web search in this chat returned. Paste the link yourself if you want me to open it." One bad URL blocks the whole call; a URL without a host is blocked.
2. **`web_extract` pages on an allowed host**: a URL opens only as it was given: the site's front page as `https://<host>/` (the host in lower case, spelled as the person or a search gave it, with `www.` only then), a link the person typed in this chat as typed or cut before a `/`, `?` or `#` (`run.start.person_links`; `http://` only when they wrote it), a Bot's address word for word, or a URL a clean `web_search` returned word for word. Anything else is blocked ("this chat has read outside content, so Timely opens only a link the person gave, one a web search in this chat returned, or a site's front page (https://site/), each written exactly as given. Paste the link yourself ..."): a path or query could carry the person's data, however short or encoded, an injected page could get its own host into the search results first, and another spelling of an allowed address (the letter case of a host or path, a trailing dot, an empty `?`, http, `www.`, a port) reaches the server as written, a bit per letter (review round 8). Go's backend also serves a page the run already read from that read, so how often a page is opened reaches no server. This is Go's `mayOpen`, applied in the worker to every backend: with a saved search key (Exa, Firecrawl, Parallel) Go sees only `gate.ask`, never the page read.
3. **`web_search` query**: blocked when it carries text from a Timely read (any Timely tool's result in this conversation except `propose_changes`; a past-chat search hit; Timely's paragraphs of this turn's message, `run.start.private_context`, and of stored turns, the paragraphs that start with one of `egress.NOTICE_PREFIXES`: the get_context result, attached context, tag, image and change notices), memory (`MEMORY.md` and `USER.md`, each entry and each file whole; and the files of every learned skill and of the person's edited copies of shipped skills in the account home, which are written from their chats; pristine shipped copies and archived skills are left out), or a tainted tool result other than `web_search`/`web_extract` (MCP, files, terminal, browser ...): "Blocked: this search would send text from the person's Timely data or memory to the web, and this chat has read outside content. Search for it yourself. Paste the link yourself if you want me to open it." Web pages and search results are left out of this corpus: they are public text already, and refining a search with them leaks nothing. The person's own words are left out too: "search for X" stays a search for X.
4. **`web_search` naming another site**: blocked when the query names a site by link (`https://host`, `//host`), `site:host`, a bare name with a port, path, or a query or fragment with something in it (`host/path`, `host?d=1`, `host#x`, `host:8443`), or a bare name whose last label is a top-level domain or a reserved one (`evil.com`, `attacker.example`, `<data>.evil.com`, an email's domain; `timely_gate/tlds.py`) that is neither in `person_hosts` nor returned by a search ("this search names `<host>`, which is not a site the person named ..."): a provider's own search (Codex's live search) may open what a query names. The query is read as a fetcher would: NFKC, the ideographic and full-width dots and the `[.]`, `(.)` and ` dot ` spellings are a dot, and a Unicode name is compared in its IDNA form. A bare name whose last label is no top-level domain, such as `node.js` or `config.yaml`, is a word, not an address; in a tainted chat a query that writes `python.org` is refused unless the person typed it or a search returned it.
5. **`web_search` naming a page**: on an allowed site, a page the query names (a link, or a bare name or IP address with a path, query, fragment or port) must pass rule 2 as a `web_extract` URL would (and must not be an address a fetcher could read differently): "this search names a page on `<host>` that the person did not give ...". A live search can open the page, so `https://<typed host>/c?d=<base64>` is a page read whatever the words in it.

Go repeats a second line for the `timely` backend (`chat/web.go` `mayOpen`, `searchNamesOtherSite`): after taint a page opens only when a search returned it word for word, the person typed it (path and query as typed), a Bot reads it, or it is the front page of a typed or searched site; a search naming another site, or a page on an allowed one that rule would not open, is refused, and a tainted run's search is search-only (`chat.WithSearchOnly`: Codex searches its cached index, not live; OpenRouter uses the Exa engine; the Anthropic API's and Claude Code's searches open no page), so an address the rule missed is never fetched. Its `results` are the provider's url citations only: a link in the answer text is the search model's writing (a page it read may have it spell out the query's words), so it is never a page a tainted run may open, in the run's first search too.

Documents longer than 50,000 characters are kept as overlapping pieces, so nothing past the first piece escapes the match.

Hosts are compared lowercase, without a trailing dot or a leading `www.`, exactly: a subdomain of an allowed host is another host.

Text matching (`egress.carries`), per document (one tool result, one memory entry or one memory file), any of:

| Check | Rule |
| --- | --- |
| Tokens | lowercase `\w+` runs (Unicode). A **distinctive** token has 4 or more characters or contains a digit, and is not a stopword (`egress.STOPWORDS`). |
| Encoded | the query is also read with its percent escapes decoded, and each base64 or hex run that decodes to readable text is checked as a query of its own (`egress.decoded_texts`). |
| Run | 4 consecutive query tokens appear consecutively in the document, at least 2 of them distinctive. |
| Whole query | the normalised query (lowercase, single spaces; at least 16 characters and 2 distinctive tokens) is a substring of the normalised document. |
| Overlap | at least 3 of the query's distinctive tokens occur in the document, and they are at least half of them. |
| Rare token | a token over `[\w@.+-]` of 6 or more characters containing a digit or `@` (phone and account numbers, emails), not a date or time, occurs in both. A number written in digit groups (`555-0142`, `555 0142`) also counts as its digits alone (`5550142`). |

Each document is cut at 50,000 characters, and every document of the conversation is kept (each once; review round 6: a count cap let an early turn's read age out of a long chat). Past 32 million characters a conversation's record is full, and a tainted `web_search` is then refused ("this chat is too long for Timely to check what a web search would send ..."). At most 256 conversations are remembered per worker (the transcript is re-read each run). A check that fails for any reason blocks the call.

Residuals: what a lookup reveals (the SSRF floor resolves each allowed extract host), text paraphrased past the token rules, and URLs built at run time inside `browser_exec` code (plan 14).
