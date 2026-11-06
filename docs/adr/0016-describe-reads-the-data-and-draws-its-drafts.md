# Describe reads the person's data and draws its drafts before answering

Described cards (ADR 0014) and live blocks (ADR 0015) used to come from one
model call that saw only the person's workspace, project, status and label
names and their sheets' columns. A program could name a project that fits
nothing, or a month the sheet writes another way ("Oct" for "October"), and
the person found out from an empty card. The person asked for the AI to have
all of their data while it builds a card, a live block or the agent's
`add_live_block`.

Describe (`POST /agent/dashboard-card` and `add_live_block`, both through
`describeCard` in `apps/api/internal/features/provider`) now runs a short
tool loop on the account's provider, like chat:

- The chat agent's read tools (`list_tasks`, `list_projects`,
  `get_sheet_values`, `search` and the rest), so the model can find exact
  names, which tab or column holds the numbers and what a column holds.
  Write tools are never offered.
- `check_block`, which draws a draft from the person's data with the apps'
  own code and returns what every block shows (numbers, rows, bars) and the
  problems: parse errors, names that are used but not defined or defined but
  not shown, `@Data` names that fit nothing (with the closest one) and
  `@Cells` sheets, tabs, columns or values that are missing.
- The answer is drawn the same way before it is taken. One with problems goes
  back to the model once; the second answer is taken as it is. A model that
  runs out of turns or never writes the program out gets the last draft it
  checked, the latest without problems first, so a weak tool user still
  ends with a card.

The card still reads its data through `@Data` and `@Cells` each time it
shows: the tools only help the model write the program, and the rule that it
never writes the person's numbers itself stands. This replaces ADR 0014's
"the model never sees the person's data": it now reads what the chat agent
can read, on the same provider the person chose.

The check runs `packages/contract/src/boardCheck.ts` bundled by `make
gen-board-check` in the API's JavaScript VM (goja), as the sheet engine does,
so the server draws exactly what the apps draw. goja has no Intl, so the
bundle fills in the date parts it needs from a host function that works them
out in the Working hours zone with Go's time zones, and writes grouped
numbers itself; only currency symbols differ ("USD 1,200.00" for
"$1,200.00"). The data comes from the services behind the apps' REST calls
(`boardData` in `cmd/agent_deps.go`), loaded once per Describe on the first
check.

A Describe now takes several model calls instead of one: up to ten turns in
a three-minute budget, the last 45 seconds kept for the answer. We chose
this over handing the model a larger summary of the data up front (it can't
know ahead which records the words are about, and a summary of every task
and sheet would not fit) and over checking only in the apps after the
answer (the person would still see the empty card first).
