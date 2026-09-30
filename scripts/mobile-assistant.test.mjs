import assert from "node:assert/strict";
import { test } from "node:test";
import { routeForNotification } from "../apps/mobile/lib/notificationRoute.ts";
import {
  contextChip,
  mergeContext,
  routeContext,
} from "../apps/mobile/lib/chat/context.ts";

test("agent notification targets its chat and retains existing reminder routing", () => {
  assert.equal(
    routeForNotification({
      category: "agent",
      entityType: "chat",
      entityId: "chat-a",
    }),
    "/(app)/assistant?chatId=chat-a",
  );
  assert.equal(
    routeForNotification({ chatId: "chat/b" }),
    "/(app)/assistant?chatId=chat%2Fb",
  );
  assert.equal(
    routeForNotification({ taskId: "task-a" }),
    "/(app)/tasks/task-a",
  );
});
test("adding a new screen preserves original context and deduplicates references", () => {
  const original = routeContext(
    "/docs/doc-a",
    {},
    { title: "Plan", workspaceId: "workspace-a" },
  );
  const incoming = routeContext(
    "/sheets/sheet-a",
    {},
    { title: "Budget", workspaceId: "workspace-a" },
  );
  const merged = mergeContext(original, incoming);
  assert.equal(merged.filter((c) => c.kind === "workspace").length, 1);
  assert.ok(merged.some((c) => c.value === "docs/doc-a"));
  assert.ok(merged.some((c) => c.value === "sheets/sheet-a"));
  assert.deepEqual(
    original.map((c) => c.value),
    ["/docs/doc-a", "docs/doc-a", "workspace-a"],
  );
});
test("scope is never silently dropped to fit context limits", () => {
  assert.throws(
    () =>
      mergeContext(
        [],
        Array.from({ length: 9 }, (_, i) =>
          contextChip("object", "Task", `tasks/${i}`),
        ),
      ),
    /maximum eight/,
  );
  assert.throws(
    () =>
      mergeContext(
        [],
        [contextChip("selection", "Japanese text", "あ".repeat(4001))],
      ),
    /too large/,
  );
  assert.doesNotThrow(() =>
    mergeContext(
      [],
      [contextChip("selection", "Japanese text", "あ".repeat(4000))],
    ),
  );
});
