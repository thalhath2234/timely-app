# Agent provider selection runs on the API host

Each account chooses which model runs its Agent runs: OpenRouter with a key
entered in Settings, or the Claude Code or Codex CLI installed and signed in
on the API host. The API host, not the client, finds and runs the CLIs so web,
desktop and mobile share one behaviour and runs still outlive chat views
(ADR 0008). A CLI is driven as a pure model with every built-in tool disabled;
the runner keeps the tool loop, proposals, approval and safe retries (ADR 0007)
in one place rather than delegating them to the CLI's own agent loop. When the
model calls a Timely tool natively regardless, the provider treats the rejected
call as the turn's tool request instead of letting the run end with "tool
unavailable".

Provider and model are fixed when a queued run is claimed, so a run finishes on
the provider it started with. If the selected provider is unusable (missing
binary, signed out, usage limit, unusable model) the run fails with a message
that names the fix; Timely never switches providers silently, because the
person chose where their data goes. Choosing a CLI provider is consent for
text, images, receipts and web search to reach that provider under the
person's own subscription; the zero-data-retention guarantee applies only to
OpenRouter's image route.

Keys are stored per account, encrypted at rest with the server secret, and are
never returned to a client. The UI never supplies a binary path: the host
scans PATH and known install directories, and `CLAUDE_BIN` / `CODEX_BIN` env
overrides cover unusual locations, so a signed-in account cannot make the
server execute an arbitrary file. `CHAT_LOCAL_CLI=off` hides host CLIs on a
shared instance. The account's OpenRouter key also drives its semantic-search
embeddings; changing the key or embedding model re-indexes that account in the
background, and the embedding model must match the index width.

Direct API providers (Anthropic, OpenAI, Gemini, DeepSeek, xAI, Mistral, Z.ai,
Kimi, Ollama, NVIDIA, OpenCode Zen and Go) sit beside OpenRouter, each with its
own encrypted per-account key, endpoint and model. They are rows in one
registry, not separate code paths. Each model is routed to one of four
protocol adapters: OpenAI chat completions (with per-provider knobs such as
the token field, temperature, and which reasoning fields must be echoed back
in a tool loop), the OpenAI Responses API (OpenAI's newest models call tools
only there; OpenCode serves GPT and Grok there), the Anthropic Messages API
through the official SDK (Anthropic, and OpenCode's Claude and Qwen models),
and Ollama's native chat API (its OpenAI-compatible endpoint cannot raise the
context window, which would silently cut the system prompt). A key is checked by
listing the provider's models, which spends no tokens; the chosen model, and
the provider when it becomes the default, are checked with one test call.
Hosted providers accept only their listed endpoints; only Ollama, which runs on
the person's own machine, takes a typed http(s) address. Choosing a direct
provider is the same consent as choosing a CLI: data goes to that provider and
the zero-data-retention route does not apply. Direct providers other than
Anthropic have no web search, so their runs do not offer the web_search tool.
Embeddings stay on OpenRouter. Subscription plans whose terms restrict them to
the vendor's coding tools (Z.ai GLM Coding Plan, Kimi For Coding) are not
offered.
