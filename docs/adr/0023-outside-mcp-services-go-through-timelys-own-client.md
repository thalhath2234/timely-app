# Outside MCP services go through Timely's own client

Bots and chat can use other apps, such as Linear, Notion, GitHub or Sentry,
through their MCP servers. Timely itself is the MCP client: the person adds a
Connected service once under Settings → Integrations ("Apps Timely can use"),
signs in with a pasted token or through the system browser, and gives each of
its tools a Tool choice: Can use (it only reads), Ask me first (it may change
things) or Off. Claude Code keeps running with `--strict-mcp-config` and no
tools except web search, and Codex with its shell and image tools turned off,
because Timely keeps the tool loop, approvals and audit (ADR 0009); writing an
MCP config for either CLI is rejected. A hosted gateway is never the only
route, and the `mcp-remote` bridge is never launched.

**Timely decides, not the service.** Tool labels from a server are untrusted,
so a tool's read-only hint never decides what may be called; the person's Tool
choice is the only authority. Services Timely hasn't checked start with every
tool Off. Timely fingerprints the address, the sign-in type and server, and
each tool's whole definition; any change pauses that tool until the person
reviews old and new side by side, and models only ever see the stored
definition the person approved. Timely never connects to itself: its own
addresses and ports, tokens with its key prefix and servers that call
themselves "timely" are refused, so an API key can't hand Bots the MCP-only
tools ADR 0007 keeps from the in-app agent.

**Fixed calls first.** A Bot uses a service through a Tool watch: one call
whose tool and arguments the person sets in the Bot editor. Plain code makes it
on schedule and compares results; only on a change does the AI judge (ADR 0021)
read before and after, as quoted data with no tools. Letting the AI pick reads
in chat and research Bots comes later, once this rule is enforced in code:
every MCP call sends its arguments out, so after a run has read the person's
Timely data or another service's results, no further MCP call happens on the
model's say-so. In chat it becomes a card with every argument shown and runs
only if the person approves it; in a research Bot it is refused. Results from a
service with a token or sign-in mark the conversation Sensitive, a notice names
any cloud model that read them, their phone pushes say only that something
changed, and a per-service Only local AI switch appears once a local model is
set up.

**Outside changes are always reviewed.** This amends ADR 0007 for tools that
change another app. They are always an Agent proposal, never rehearsed by
really calling them, and checked again at apply time against the approved
definition, address and sign-in. A failed or timed-out outside change is never
retried by itself. From phase 4, Bots may propose such changes as an Agent
proposal for the person to apply, never applying one on their own; such a
proposal is not an MCP call, so the egress rule above does not refuse it. Until
then, Ask me first tools never appear in a Bot run.

**Secrets live in the Secure Store.** Tokens, access and refresh tokens and
client secrets are sealed under `TIMELY_VAULT_KEY` (ADR 0022), bound to the
account, the connection and the address or sign-in server, write-only, and
never sent anywhere else. Sign-in follows the MCP authorization spec with PKCE
(S256 required) and the resource parameter, in the system browser, never an
embedded view, back to a callback with a one-use state and a cookie: on the
desktop, the API's own loopback address; on server and Docker installs, and for
phone sign-in, the install's own https address, registered by automatic
registration or the person's own app. Timely registers itself with its
published client document (a Client ID Metadata Document hosted on the
project's GitHub Pages site, the preferred way), automatic registration, or the
person's own OAuth app. The sign-in server must belong to the service: Timely
pins it for checked services and shows a blocking warning when an unchecked
service names another domain's. Timely refreshes tokens itself under a database
row lock, and unattended runs never open a browser or register; they pause the
Bot with "Needs sign-in". Server and Docker installs get tokens and sign-ins
only once they set the vault key and have an https address. There, services may
use only ports 443 and 8443, adds and checks are rate-limited per account, and
a failed connect gives a generic error, so an account can't use the server to
scan other machines.

Every dialled address, the MCP transport and each sign-in request included,
goes through the same address guard as the Bot fetcher, on any port; a server
on the person's own network is allowed only for its exact host and port after
the owner ticks it. Programs that run on the person's PC (stdio servers) come
in phase 5, desktop only: each with its exact command shown, installed from a
lockfile with integrity hashes and install scripts off, run directly (never
through npx resolution, @latest or docker) with a stripped environment, and
approved again after any change. Only the person adds one; chat, MCP, API keys
and Bots never can.
