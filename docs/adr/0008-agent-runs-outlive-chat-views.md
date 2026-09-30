# Agent runs outlive chat views

Agent runs execute on the server and retain progress and results in conversation
history so navigation and closing the chat overlay do not interrupt approved
work. This requires execution state independent of the browser connection rather
than making a chat request's lifetime the run's lifetime. Stop prevents further
steps while preserving completed changes. Notify the person when execution
finishes or approval is required through persistent in-app notifications and a
Chat unread badge linking to the conversation. Electron also delivers native
desktop notifications while running but unfocused. Delivery after fully quitting
the app is deferred.
