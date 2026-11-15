// Where a notification opens (apps/web/app/_components/notifications/notificationTarget.ts):
// the Notifications page's rows, and a desktop alert clicked in the system tray.
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

test("a bot notification opens its Bot thread in the Assistant", () => {
  const alert = note({
    category: "bot",
    data: { botId: "bot_1", alertId: "bal_1" },
  });
  assert.deepEqual(targetFor(alert), {
    kind: "route",
    href: "/assistant?bot=bot_1&thread=1",
  });
});

test("a bot notification that names its thread opens that thread", () => {
  const alert = note({
    category: "bot",
    data: { botId: "bot_1", threadId: "cht_9" },
  });
  assert.deepEqual(targetFor(alert), {
    kind: "route",
    href: "/assistant?bot=bot_1&thread=cht_9",
  });
});

test("a bot notification without a bot id opens the Assistant", () => {
  assert.deepEqual(targetFor(note({ category: "bot", data: {} })), {
    kind: "route",
    href: "/assistant",
  });
  assert.deepEqual(targetFor(note({ category: "bot" })), {
    kind: "route",
    href: "/assistant",
  });
  assert.equal(
    botHref({ data: { botId: 42 } }),
    "/assistant",
    "only a string id counts",
  );
  assert.equal(
    botHref({ data: { botId: "bot a&b" } }),
    "/assistant?bot=bot+a%26b&thread=1",
    "the id is escaped",
  );
});

test("a chat notification opens its chat in the Assistant", () => {
  assert.deepEqual(
    targetFor(note({ entityType: "chat", entityId: "chat_1" })),
    { kind: "route", href: "/assistant?chat=chat_1" },
  );
  assert.deepEqual(targetFor(note({ data: { chatId: "chat_2" } })), {
    kind: "route",
    href: "/assistant?chat=chat_2",
  });
});

test("other notifications keep their targets", () => {
  assert.deepEqual(targetFor(note({ data: { taskId: "tsk_1" } })), {
    kind: "task",
    id: "tsk_1",
  });
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

test("a clicked desktop alert opens the Bot thread of the notification in the cache", () => {
  const cached = [
    3, // ["notifications", "unread-count"]
    { quietHours: true }, // a settings entry
    undefined, // a query that has not loaded
    [note({ id: "ntf_other", category: "bot", data: { botId: "bot_other" } })],
    [note({ id: "ntf_7", category: "bot", data: { botId: "bot_7" } })],
  ];
  assert.equal(
    openedAlertHref("ntf_7", cached),
    "/assistant?bot=bot_7&thread=1",
  );
  assert.equal(
    openedAlertHref("ntf_other", cached),
    "/assistant?bot=bot_other&thread=1",
  );
});

test("a clicked chat notification in the cache opens its chat", () => {
  assert.equal(
    openedAlertHref("ntf_c", [
      [note({ id: "ntf_c", entityType: "chat", entityId: "chat_5" })],
    ]),
    "/assistant?chat=chat_5",
  );
});

test("a clicked desktop alert that is not in the cache opens the Assistant", () => {
  assert.equal(openedAlertHref("ntf_gone", []), "/assistant");
  assert.equal(
    openedAlertHref("ntf_gone", [[note({ id: "ntf_1" })], 0]),
    "/assistant",
  );
  assert.equal(
    openedAlertHref("ntf_1", [
      [note({ id: "ntf_1", category: "bot", data: {} })],
    ]),
    "/assistant",
  );
});
