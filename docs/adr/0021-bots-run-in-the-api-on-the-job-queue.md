# Bots run in the API on the job queue

A Bot is a saved description plus one or more Watches that the API checks on
its own schedule, with nobody watching, and that tells the person when
something worth knowing changed. Bots run inside the Timely API, on the same
Postgres job queue that sends Reminders, as a `bot_check` job kind in a lane of
its own. They do not run on the phone, which Android lets run every 15 minutes
at best, and the project runs no hosted runner, because ADR 0011 keeps every
install self-contained and nobody pays for servers. The desktop app starts at
login, hidden in the tray, and is on by default, upgraders included with a
one-time notice. Bots keep running while the window is hidden and stop on Quit.
When the PC was off or asleep, each overdue Bot checks once on start or wake,
after the network is back and spread over a few minutes, and the person gets
one "While you were away" alert instead of a pretence that nothing happened.

**The Bot's own next-check time is the only schedule.** A check never queues
the next one. The existing sweep queues Bots that are due, so a failed job, a
restart or a restore can't stop a Bot for good. Bot checks get one or two slow
retries instead of the queue's eight fast ones and sort their errors: offline
is no strike, 429 and 503 wait for Retry-After, and a captcha, a block or a
missing page is a strike. After five strikes in a row the Bot pauses itself and
sends one alert that says why, with Resume. An empty page, feed or price
reading counts as broken, not changed; an empty successful Tool watch result is
a real reading (ADR 0023). Saving the new value, the check and the alert
happens in one transaction. Editing a Watch, or the first check after a
restore, quietly records a fresh starting value instead of re-sending old
alerts. An alert held by quiet hours is rechecked or labelled with the time it
was seen.

**Watches are plain web requests.** A page watch keeps the readable text, one
part picked by a CSS selector, or the price the page publishes in its product
data. A feed watch reads RSS, Atom and JSON Feed. A price watch reads a symbol
from a free source (Yahoo's chart endpoint, CoinGecko) into a compact series
kept for a year, separate from the check log. Every request goes through a bot
fetcher built on the link preview address guard: public addresses only, ports
80 and 443, checked again on every redirect, so a Bot can't probe the person's
network or Tailscale devices. Timely identifies itself, honours robots.txt and
Retry-After, waits at least 15 minutes between checks of a page or feed, 5
minutes for a price while its market is open and 6 hours for a shop product,
and spaces requests to one site 10 seconds apart across all Bots on the
Bots. It never solves captchas, fakes a user agent or rotates proxies.

**Rules spot a change; the AI only judges it.** Each check is plain code that
compares the new reading with the last one against the Bot's rules (a line
crossed, a move of some percent, words that appear, anything changed, a new
feed item). A rule fires once when it becomes true and again only after it
resets or moves a further step. Only a change that passes the rules reaches the
AI, and only for Bots set to "AI judges". The judge gets the Bot's description,
its Lessons, the last alert and the before and after as quoted data, has no
tools, and answers in a fixed shape: alert or not, a title, one line on why,
and how urgent. Numbers in an alert are filled in by code, never by the AI.
When the AI can't judge (no provider running, no credit, an answer that doesn't
parse), the change goes out straight away marked "Not checked by AI", is judged
again when the AI is back, and is followed up only if the verdict changes; AI
failures never count as strikes. Bots use the Bots model, which defaults to the
cheapest model of the default provider (ADR 0020). While no default provider is
chosen, AI-judge Bots send changes marked "Not checked by AI" instead of
waiting. Each Bot gets 20 judgements a day and each account 200, after which
Bots fall back to rules and say so.

**People make Bots in chat and edit them on the Bots page.** A Bot described in
chat or the Quick prompt arrives as an Agent proposal of grouped rows, and
Approve creates it; the agent first reads the page in a separate step with no
tools and shows what it found ("Right now it reads: Rs 27,499") so the person
can say "That's not it". "New bot" also opens a blank editor, so Bots work with
no AI at all. Useful and Not useful on every alert keep up to 20 short Lessons
per Bot, and three Not useful in a row suggest a rule change as a proposal.
Tagging a Bot with @ in chat or the Quick prompt answers from its Findings and
runs a fresh check only when they are over an hour old. That check runs at most
once every 5 minutes, never sooner than the Watch's own minimum interval, and
counts toward the Bot's usual caps. A tagged Bot only answers. Outside agents
can create, list, update, pause and run Bots over MCP. Bots they create start
paused until the person turns them on in the app. MCP can never attach a
sign-in or a Connected service to a Bot, change tool access, or change where
alerts go, and it never sees signed-in results. This extends ADR 0007: creating
a Bot through chat is always a proposal, because a Bot acts later on its own.

**Alerts are notifications of their own.** Bot alerts are a notification
category with their own Android channel, follow the Notifications quiet hours
unless the Bot is Urgent, pop natively on desktop, and stop at about 3 a day
per Bot, then "and N more". Phone alerts arrive through the existing background
check first; instant Expo push follows once the release APK has an Expo project
and Firebase set up. Bot findings get a "From your bots" section in the morning
digest (08:00 unless the person moved it). In CONTEXT.md:205: "The morning
digest is not a Brief; it gets its own 'From your bots' section." Add "briefing
(the morning digest's picks)" to Brief's Avoid list.

**Bots stay small.** Up to 25 Bots per account. Each check keeps at most 64 KB
of extracted text, and the check log keeps 30 days or the last 500 checks. Bot
checks run at most 4 at a time per API process, on a new multi-slot lane (lanes
run one job at a time today), so they never hold up Reminders or chat. Per-site
spacing lives in the database so it holds across processes and across every
account on the install. A Bot never buys, posts or deletes anything, and signs
in only with a Sign-in the person attached to it, on its own only where that
login allows it (ADR 0022). Bots that use other apps are ADR 0023.

Bots working together exchange typed notes on a findings board, never free text
addressed to another Bot, because one Bot's page could otherwise instruct the
next. Findings from signed-in pages or services reach another Bot only when the
person ticks "may read signed-in results" on that link, and never reach MCP
agents. Links that would form a loop are refused when saved. Notes from fetched
pages carry an outside-data mark, a chain is at most 3 Bots deep and 6 AI calls
long, and the person gets one alert per thing across Bots.
