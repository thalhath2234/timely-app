# Bots judge with AI and pass notes to each other

Bots began as plain code: a Check compares a reading with the last one against
the Bot's rules and alerts when a rule fires. That stays the base. This ADR
records three things added on top of it: an AI judge that decides whether a
change the rules spotted is worth telling the person about, teaching that feeds
the person's answers back to that judge, and Bots that work together by passing
notes to each other or gathering them into a brief. Each one adds AI cost, a
new way for page text to reach a model, or a new way for one Bot to start work
in another, so each comes with a limit the person can see.

This changes ADR 0021 in three places. Checks now run three at a time, with
passed items and re-judges sharing one more slot. An alert is judged again
only after a passing error, never when no provider is set up or chosen, the
CLI is off, the key is missing or the cap is reached. And the judge uses a
known small model only on Anthropic and the Claude Code CLI; elsewhere it uses
the account's own model.

**The judge sits behind an interface in `bots`.** `bots.Judge` has three calls:
`Ready`, `Judge` and `WriteBrief`. The `provider` package implements it, and
`cmd/main.go` wires it with `botService.SetJudge(providerService.BotJudge())`.
`bots` cannot import `provider`, because `provider` already imports the agent,
which imports `bots`; this is the same seam as the bot digest and the live
block writer. With no judge set, `Ready` reports AI as off and every Bot runs
on rules alone. The judge runs on the account's default provider (ADR 0020),
on its small model where Timely knows one (Anthropic and the Claude Code CLI);
other providers use the account's own model.

**The judge runs between the rules and the save, never inside it.** A Check
reads its Watches, classifies the result, then makes a dry run of the rules
(`planCheck`). Only when rules fired on a Bot set to "AI judges" does it call
the judge, and then it saves. The save's transaction holds `FOR UPDATE` on the
Bot row, so a model call there would hold a lock for up to 30 seconds. The dry
run is pure, and the check's claim fence keeps the rule state fixed while the
judge answers. If a Watch was edited in the meantime, the save's own
evaluation differs from what the judge saw, and the alert goes out in the
rules' words marked "Not checked by AI".

**One judge call per Check.** The call covers up to five fired changes, with
"+N more" for the rest, and its verdict applies to that Check's one alert, as
a Check already raises one alert. A verdict of "not worth it" still writes the
alert row, held as judged and without a notification, so the person can see
what AI held back and rate it Useful ("should have told me"). When AI is
unavailable, the rules' alert goes out marked "Not checked by AI" and is judged
again after 15 minutes, an hour and three hours; only a later "not worth it"
rewrites the notification, without a second push. No provider, no chosen
provider, a CLI that is off, a missing key and a used-up cap give "Not checked
by AI" with the reason and no retry, because asking again cannot succeed.

**AI calls have daily caps, counted in a log.** Each call reserves a row in
`bot_ai_calls` first, under the advisory lock `bot_ai:<user>`: 20 per Bot per
local day, 200 per account per local day, and 6 per chain, whichever Bot in the
chain makes them. Re-judges count against their original chain, and AI briefs
count too. The log and the pass log have no foreign key to `bots`, so deleting a
Bot or restoring a backup does not reset a count. The same rows feed "AI checks
37 of 200" on the Bots page and serve as an audit log. Linking Bots never adds
budget.

**AI urgency is shown, never obeyed for quiet hours.** The judge rates a change
low, normal or high. Timely stores and shows that, and it counts as a jump in
urgency for shared alerts (below). It never sets the notification's urgent
flag: only the person's Urgent switch on a Bot breaks quiet hours, because text
on a page must not be able to wake someone up.

## Why the judge has no tools, and Bots send no free text

A Bot reads pages anyone can write. Whatever the judge sees, an attacker may
have written. So the judge gets no tools (`search` off too), runs as a one-shot
call marked sensitive, and answers in a fixed JSON shape: alert or not, a
title, one line on why, and how urgent. An answer that does not parse counts
as unavailable. The prompt has a fixed system message and one user message
with two blocks. `<person>` holds the Bot's description and its Lessons, which
only the person and code wrote; it is the only place the judge takes wishes
from. `<data>` holds the changes, the last alert, a passed note and the
person's doc or sheet ("knowledge"), each marshalled as JSON with HTML escaping
on, so page text cannot close a block. The worst a page can do is steer one
verdict on one alert.

To keep it at one, text the model writes lives only in the alert it judged (its
title and why) and in an AI brief's body. Findings, Lessons, the next
judgement's "last alert", passed notes, brief lines and MCP `list_bots` all use
the words code made from the rules. A Lesson is written by code from that
alert's rules-made words plus the person's own note, so nothing a page or the
model wrote becomes an instruction later. Over MCP, an outside app cannot turn
on judging, set knowledge, links or briefs, or change the name or
description of an AI-judged Bot or an AI brief, since the description is what
the judge obeys and the name goes into the Lessons it reads.

**Bots never write free text for each other (G9 rejected).** A proposal let
one Bot hand the next an instruction ("check whether this is in stock"). That
would turn every page a Bot reads into a way to give orders to the next Bot,
and the next Bot's judge would have to obey `<person>` and ignore `<data>` at
the same time. Bots pass typed notes instead: a title up to 120 characters, a
why up to 400, a link and typed values such as a price, all marked as outside
data. The receiving Bot checks the note against its own rules, and its judge
sees the note inside `<data>` only.

## Passing notes and briefs

**One alert per thing.** When two Bots alert on the same product, ticker or
link on the same local day, the second is held as shared and the first alert
shows "Also seen by". A follow-up gets through only after a further 5% move or
a jump in urgency. Thing keys come from the Watch
(`price:<source>:<symbol>[:<currency>]`, so BTC in USD and in USDC are two
things, or a normalised page address) or the feed item's link, falling back to
the item within its feed when it has no public link. Sharing runs inside the
alert step under its own advisory lock `bot_things:<user>`. It cannot reuse the
account lock: editing a Bot takes the account lock and then the Bot row, while
the save already holds the Bot row, so reusing it would take the two in the
opposite order and risk a deadlock.

**Pass to checks the note under the receiving Bot's own rules.** A link from
Bot A to Bot B has up to five filter words. When A finds a note that holds one
of them (or the filter is empty), A stays quiet about it and B checks it. If
one of B's page watches is on the same site as the note's link, B reads that
link with that watch's read mode and selector, unless B already made such a
read within its minimum interval. Otherwise B tests its rules against the
note's own price and text. Rules use "holds now", since the note is new to B.
An AI-judged B also judges. B's own Watches, schedule, fence and strikes are
untouched, and a failed read of a passed link counts no strike against B. The
alert comes from the end of the chain and shows "How this came to you", with
"Shouldn't have been passed on" and "Turn off this pass".

**Which items a link takes is decided before the save.** The choice is
deterministic: the filter matches, the target is active and watches something,
and the chain is at most three steps deep. Inside the save, under the things
lock, each taken item becomes pending, overflow (more than 10 from one Check, or
more than 20 from one link in a day) or repeat (the same thing passed to the same
Bot within 7 days). A stays quiet in all three cases, so the limits are exact
without changing what A alerts. Overflow, failed reads and passes over 24 hours
old are not dropped: they are folded into the next brief and the morning digest
instead of being checked.

**No loops.** Saving a link refuses any cycle and any path longer than three
links, checked over the whole link graph of the account; a restore trims the
same way. At run time, a chain stops at depth three.

**Passes have a lane of their own.** The job worker runs Bot checks three at a
time and passed items and re-judges in one shared slot, so a busy chain never
holds up scheduled checks.

**A brief is a Bot with no Watches.** It runs daily at the time the person
picks and sends one alert listing new Findings from up to eight Bots, at most
five per Bot plus "and N more", from a template or with one AI call when
"Write it with AI" is on. Findings stay in the 08:00 digest too. A source Bot
can be set to "Only in the brief", which counts only while it is in an active
brief.

**One switch stops everything.** "Pause all bots" sets
`configs.bots_paused_at`. While it is set, the sweep skips the account, queued
checks end, waiting passes fold into the next brief, re-judges stop, and Run
now and Ask answer 409. Each Bot keeps its own status, so turning the switch
off brings back exactly what was running.
