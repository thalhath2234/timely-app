# Cards read a doc's checklist and tick it through the server

The person asked Describe for "a shopping list from the doc shopping", and
the agent "what's on my shopping list". The doc held the list as tick boxes,
but nothing a card or a reply could use read them: `@Data` lists docs only by
title and edit time, and the reply kit had no row for an item in a doc. The
card showed the doc's name and an empty task list, with an "Open Tasks" link
copied from an example; the reply listed the items as plain rows with no tick
boxes.

A card program now reads a doc's checklist with `@Checklist({doc, state,
text, limit})` and draws each item as a `CheckRow(docId, text, note, item)`,
a row in both the reply kit and the board kit, so replies, Described cards
and Live blocks show the same thing. Describe's brief lists up to twelve
checklists with their items, so the model names a doc and its items as the
doc has them, and `check_block` reports a doc that isn't there, a doc with no
checklist and an Open link with a missing or unknown id.

An item is known by its place among the doc's checklist items, in doc order
with nested ones and empty ones counted, and by its words.
`packages/contract/src/docChecklist.ts` and `internal/richtext/checklist.go`
number them the same way.

A tick from a card calls `PUT /docs/:id/checklist` with `{item, text, done}`.
The server changes that one item in the doc as it is now and saves it as a
normal edit, with a version and a live update to open editors. If the item at
that place has other words, the server ticks the first item with those words;
if none has them, it answers 409. We chose this over the app writing the
whole doc back after changing its own copy. A card's copy of the doc can be
minutes old, and writing it back would undo whatever the person or the agent
changed in between. The apps still change their own copy at once and undo
it if the server refuses.
