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
test("a smart alert about several tasks opens the first, a project or Inbox alert its own screen", () => {
  assert.equal(
    routeForNotification({ category: "suggestion", kind: "stale", taskIds: ["task-a", "task-b"], entityId: null }),
    "/(app)/tasks/task-a",
  );
  assert.equal(
    routeForNotification({ category: "suggestion", kind: "project", projectId: "pr-a", taskIds: ["task-a"] }),
    "/(app)/projects/pr-a",
  );
  assert.equal(
    routeForNotification({ category: "suggestion", kind: "inbox", taskIds: ["task-a"] }),
    "/(app)/inbox",
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

const { receiptReviewProblems } = await import(
  "../apps/mobile/lib/chat/receiptReview.ts"
);
const receipt = (items = ["179", "398", "398", "684", "248", "236"]) => ({
  merchant: "業務スーパー",
  date: "2026-09-30",
  currency: "JPY",
  total: "2318",
  subtotal: "2147",
  tax: "171",
  tip: "",
  discount: "",
  category: "groceries",
  taxIncluded: false,
  issues: [],
  items: items.map((amount) => ({
    description: "Printed item",
    amount,
    quantity: "1",
    unitPrice: amount,
    category: "",
  })),
});
test("receipt review explains the missing bag amount and clears after correction", () => {
  const problems = receiptReviewProblems(receipt());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /2143.*2147.*Difference: 4/);
  assert.deepEqual(
    receiptReviewProblems(
      receipt(["179", "398", "398", "684", "248", "236", "4"]),
    ),
    [],
  );
});
test("receipt review handles decimal currencies and included tax/discount", () => {
  const draft = {
    ...receipt(["0.1", "0.2"]),
    currency: "USD",
    subtotal: "0.3",
    total: "0.3",
    tax: "0.02",
    discount: "0.1",
    taxIncluded: true,
    discountIncluded: true,
  };
  assert.deepEqual(receiptReviewProblems(draft), []);
});
test("summary-only receipts and incomplete items have useful review feedback", () => {
  const summary = { ...receipt([]), subtotal: "", tax: "" };
  assert.deepEqual(receiptReviewProblems(summary), []);
  const incomplete = {
    ...summary,
    items: [
      {
        description: "",
        amount: "",
        quantity: "",
        unitPrice: "",
        category: "",
      },
    ],
  };
  assert.deepEqual(receiptReviewProblems(incomplete), [
    "Enter a name for item 1.",
    "Enter the amount for item 1.",
  ]);
});
