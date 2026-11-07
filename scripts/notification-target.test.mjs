// Where a notification opens (apps/web/app/_components/notifications/notificationTarget.ts):
// the Notifications page's rows, and a desktop Bot alert clicked in the system tray.
import assert from "node:assert/strict";
import test from "node:test";
import {
  botHref,
  openedAlertHref,
  targetFor,
} from "../apps/web/app/_components/notifications/notificationTarget.ts";

const note = (fields) => ({
  id: "ntf_1",
  category: "reminder",
  title: "",
  body: "",
  readAt: null,
  createdAt: "2026-11-07T09:00:00Z",
  ...fields,
});

test("a bot notification opens its bot on the Bots page", () => {
  const alert = note({
    category: "bot",
    data: { botId: "bot_1", alertId: "bal_1" },
  });
  assert.deepEqual(targetFor(alert), {
    kind: "route",
    href: "/bots?bot=bot_1",
  });
});

test("a bot notification without a bot id opens the board", () => {
  assert.deepEqual(targetFor(note({ category: "bot", data: {} })), {
    kind: "route",
    href: "/bots",
  });
  assert.deepEqual(targetFor(note({ category: "bot" })), {
    kind: "route",
    href: "/bots",
  });
  assert.equal(
    botHref({ data: { botId: 42 } }),
    "/bots",
    "only a string id counts",
  );
  assert.equal(
    botHref({ data: { botId: "bot a&b" } }),
    "/bots?bot=bot%20a%26b",
    "the id is escaped",
  );
});

test("other notifications keep their targets", () => {
  assert.deepEqual(targetFor(note({ data: { taskId: "tsk_1" } })), {
    kind: "task",
    id: "tsk_1",
  });
  assert.deepEqual(
    targetFor(note({ entityType: "chat", entityId: "chat_1" })),
    { kind: "route", href: "/chat?id=chat_1" },
  );
  assert.deepEqual(targetFor(note({ entityType: "doc", entityId: "doc_1" })), {
    kind: "route",
    href: "/files/doc_1",
  });
  assert.deepEqual(targetFor(note({ category: "digest" })), {
    kind: "route",
    href: "/dashboard",
  });
  assert.deepEqual(
    targetFor(
      note({
        category: "suggestion",
        data: { items: [{ id: "tsk_9", name: "Plan" }] },
      }),
    ),
    { kind: "task", id: "tsk_9" },
  );
  assert.deepEqual(targetFor(note({})), { kind: "route", href: "/today" });
});

test("a clicked desktop alert opens the bot of the notification in the cache", () => {
  const cached = [
    3, // ["notifications", "unread-count"]
    { quietHours: true }, // a settings entry
    undefined, // a query that has not loaded
    [note({ id: "ntf_other", category: "bot", data: { botId: "bot_other" } })],
    [note({ id: "ntf_7", category: "bot", data: { botId: "bot_7" } })],
  ];
  assert.equal(openedAlertHref("ntf_7", cached), "/bots?bot=bot_7");
  assert.equal(openedAlertHref("ntf_other", cached), "/bots?bot=bot_other");
});

test("a clicked desktop alert that is not in the cache opens the board", () => {
  assert.equal(openedAlertHref("ntf_gone", []), "/bots");
  assert.equal(
    openedAlertHref("ntf_gone", [[note({ id: "ntf_1" })], 0]),
    "/bots",
  );
  assert.equal(
    openedAlertHref("ntf_1", [
      [note({ id: "ntf_1", category: "bot", data: {} })],
    ]),
    "/bots",
  );
});
