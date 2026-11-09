# Agent runs outlive chat views

> Amendment (2026-11-09, plan phase 2): a chat turn on the agent engine runs in
> the account's Hermes worker (ADR 0026, proposed). The poller that claims the
> turn names the run on the conversation and hands it on; a follower in the
> same API process keeps the lease and records the turn's end, so no poller
> waits on it and Timely sets no turn or time cap of its own (Stop always ends
> it; the classic engine keeps its 12 turns and 10 minutes). When the lease
> lapses, the poller that takes it over re-attaches the run if its process
> still follows it, and otherwise marks it failed with Try again. Timely data
> is safe in either case, because only the model-free apply writes it. Stop,
> Retry and Delete end the worker's run after they commit.

Agent runs execute on the server and retain progress and results in conversation
history so navigation and closing the chat overlay do not interrupt approved
work. This requires execution state independent of the browser connection rather
than making a chat request's lifetime the run's lifetime. Stop prevents further
steps while preserving completed changes. Notify the person when execution
finishes or approval is required through persistent in-app notifications and a
Chat unread badge linking to the conversation. Electron also delivers native
desktop notifications while running but unfocused. Delivery after fully quitting
the app is deferred.
