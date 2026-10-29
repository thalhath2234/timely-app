# Described cards ask the model once and read the data live

"Describe a card" turns the person's words ("overdue client work and what's
due this week") into a dashboard card. The account's AI provider writes one
OpenUI Lang program over the Reply card kit (ADR 0013) through `POST
/agent/dashboard-card`, and every number, row and bar in it comes from an
`@Data({...})` call (`packages/contract/src/genuiBoard.ts`). The apps answer
those calls from the data the dashboard already loaded, with the same engine
as custom cards (`computeCard`), so the card stays current, works offline on
the phone and never goes back to the model. Further words send the card's
program with the change and get the whole program back.

We chose this over asking the model each time the card shows (slow, costs
tokens on every refresh, needs a key on every device) and over having it fill
the card workshop's query (one query per card, so no "stats plus a list"
cards). OpenUI's own `Query()` was skipped: it needs a tool provider and draws
its defaults before the answer arrives, while `@Data` is synchronous.

The model never sees the person's data, only their workspace, project,
status and label names, so `@Data` matches names case-insensitively and a
name that matches nothing finds nothing rather than everything. A described
card is saved as a custom card whose query is the nearest plain card plus
`described: {prompt, program}`; apps without described cards draw the plain
card and keep the program when they save the layout. The phone works out
every prop itself (`drawBoard`) because the package's renderer draws DOM.
