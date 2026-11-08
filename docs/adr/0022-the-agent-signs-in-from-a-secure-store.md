# The agent signs in from a Secure Store the AI can't read

Some Bots and chat requests need a site the person is signed in to, such as a
bank balance or an order page. Timely signs in for the person: logins are kept
in a Secure Store, the agent drives a headless browser, and Timely, not the AI,
types the saved password. The words in the app are "Timely types your saved
password. The AI never sees it." The browser is the person's own Edge, Chrome
or Chromium, run headless with one profile per login; Timely never bundles a
browser. Captcha solvers and hiding that the browser is automated are rejected.
Where a site refuses this browser (Google sign-in), the person signs in
themselves in a real window and Timely keeps that session.

**The Secure Store is a database table sealed with its own key.** Each saved
login holds the exact https address, the username, the password and, opt in, an
authenticator key, each sealed with AES-256-GCM and bound to the account, the
login and the address, so a row copied elsewhere won't open. The key is a new
desktop secret, `TIMELY_VAULT_KEY`, made by the desktop app, sealed with
Electron `safeStorage` and handed to the API the way the backup key is (ADR
0011). It is separate from the key that protects AI keys and has no fallback to
another secret. Without it, as on dev and server installs that don't set it,
the Secure Store is off. Saved website logins, the headless browser and Only
local AI are desktop-only; a server install that sets the key gets only
Connected service tokens and sign-ins (ADR 0023). A local model is Ollama at a
loopback address on this PC, answering, with a tool-capable model that isn't an
Ollama cloud model. Remote Ollama, API providers, OpenRouter, Claude Code and
Codex never count, and this is checked on every model call. Secret fields are
write-only: no API response, log, export or phone gets them back, only a hint.
On Linux without GNOME Keyring or KWallet, Timely refuses bank, email, health,
government and payments logins. The encryption protects a stolen disk or a
leaked backup; what keeps the AI away from the password is the tool boundary.

**The AI holds a ticket, never a secret.** Logins are added in a modal that
posts straight to REST, never through chat, so chats, run logs and the job
queue never hold them. The agent sees pages as cleaned text with numbered
elements and asks Timely to fill a field by number with a login's ticket.
Timely types only when the page is https with no certificate error, its address
exactly matches the saved one, the field's own frame is on that site and the
field is the right kind, then lets exactly one sign-in request through, once.
The model never gets a way to run script in the page, because a password field
is readable from script. One password try per run and three a day per login; a
wrong password marks the login "Needs checking" and stops automatic sign-ins.
Codes sent by text or email wait for the person on a card on PC and phone, and
authenticator keys for banks stay off unless the person turns them on.

**Signed-in pages are private and read-only.** After a sign-in, the page only
reads: the browser lets GET requests through and turns any other request into
"Allow this request?" with field names only, and transfers, payments and
settings changes are refused. The run stays on that site. The conversation is
marked Sensitive (no web search, OpenRouter's zero-data-retention route when
the chat runs on OpenRouter, no Jev or embeddings), only page text reaches a
cloud model, never screenshots, and a notice names the cloud model that read
it. Any AI may read signed-in pages; when a local model is set up, an "Only
local AI" switch per login keeps that site's pages on it and never falls back
to a cloud model.

**The person can watch and take over at any time.** Every browser step can open
a live view, and on a private site it opens by itself. The live view shows the
page as pictures kept in memory only, under a header Timely draws itself with
the real site, the agent's step, which AI is reading, Take control and Stop, on
public and private pages for the whole run. On Google sign-in pages Take
control offers the real-window sign-in instead. Take control pauses the agent
at once: the lock is checked before every model and tool call, the AI reads
nothing while the person is in control, read-only stays on with Allow once
only, and fields Timely filled are cleared. Give back checks the site again
before the agent takes another step, and 15 minutes without the person stops
the run. The run parks in a "browser" wait that keeps its transcript, with
private text held as placeholders, so it carries on where it stopped, and only
one device holds control at a time.

Signed-in Bots never sign in on their own for bank, email, health, government
or payments logins unless the person turns that on per login. Browser and
sign-in tools, Take control and page input are never offered over MCP or to API
keys. Pushes about private sites say only that a Bot needs the person or found
a change. If the vault key is lost or replaced, every saved login reads "Sign
in again" instead of failing quietly.
