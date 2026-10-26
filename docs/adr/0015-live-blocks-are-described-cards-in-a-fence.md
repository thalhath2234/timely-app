# Live blocks are described cards kept in a code fence

A doc can hold a live block: a card of the person's own tasks, reminders,
inbox, events, projects, docs or sheets that draws itself from their data
each time the doc opens. It is a described card (ADR 0014) inside a doc: the
same `Panel` program over the same kit, written once by the account's AI
provider from words, with every number and row coming from `@Data({...})`.
The doc keeps the program as a ```` ```openui-lang ```` code block, so the doc
stays Markdown (docs/markdown.md): export, import, versions, the agent's
`get_doc`/`update_doc` and other Markdown apps all see an ordinary code block.

We chose the fence over a new node type with its own attributes (it would
need a Markdown form of its own, and every reader that doesn't know it would
drop it) and over embedding a dashboard card by id (the block would break
when the card is removed, and a doc would depend on the dashboard's layout).
The fence language is the one reply cards use (ADR 0013), so the apps and
the model see one kind of program.

The editors draw the block at the doc's width and hide the program unless
asked for or the caret is in it; the word count and search skip it. The
phone's doc editor is a web page, so the app works out each program
(`drawBoard`) and hands the page HTML built from the phone kit
(`liveBlockHtml.ts`); ticks and links go back to the app, which does them.
The agent never writes the fence itself: `add_live_block` takes words and
asks the same provider with the same instructions as the Describe dialog,
plus a note that the block takes the doc's width, so every block it adds is
one the apps can draw. Changing a block with `block=N` needs the person's
review, like other agent edits to existing content.

A program reads a sheet's cells with `@Cells({sheet, tab, label, value})`,
which can also filter, group, sort and keep the latest rows. The apps work
the cells out with the sheet's own formula engine and find a column by the
name the person sees: its own name, a name typed in the first row, or its
letter. Rows of totals are left out, so nothing counts twice
(`sheetCells.ts`). The API lists the person's latest sheets, their tabs and
columns to the model with the same code, run in its JavaScript VM like the
formula engine, so a program only names columns the apps find. A sheet,
tab or column name that matches nothing draws an empty block, never another
column's numbers. Dashboard described cards get `@Cells` too.
