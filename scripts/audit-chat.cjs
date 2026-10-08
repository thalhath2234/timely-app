const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHAT_BROWSER
      ? { executablePath: process.env.CHAT_BROWSER }
      : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    // CHAT_VIDEO=<dir> records the run; `marks` gives the island segment.
    ...(process.env.CHAT_VIDEO
      ? {
          recordVideo: {
            dir: process.env.CHAT_VIDEO,
            size: { width: 1440, height: 1000 },
          },
        }
      : {}),
  });
  // Keep the Next.js dev badge from covering the sidebar's bottom corner.
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.append(style);
    });
  });
  const videoStart = Date.now();
  const marks = {};
  // UI audit uses mocked, account-scoped responses; no personal account data.
  await context.addCookies([
    { name: "refresh", value: "ui-audit", url: "http://localhost:4002" },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const chat = {
    id: "chat_audit",
    title: "Build a project budget",
    status: "approval",
    phase: "apply",
    webSearch: false,
    context: [],
    revision: 2,
    unread: true,
    error: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      {
        id: "msg1",
        role: "user",
        content: "Create a budget sheet for the PDF tool project.",
        createdAt: new Date().toISOString(),
      },
      {
        id: "msg2",
        role: "assistant",
        content:
          "I’ll create a budget in your PDF tool project, with quantities, unit prices, and calculated totals. Here’s the proposed structure.",
        createdAt: new Date().toISOString(),
      },
    ],
    plan: [
      {
        tool: "create_sheet",
        summary: "Create “PDF tool budget” in your PDF tool project.",
        arguments: { title: "PDF tool budget" },
        status: "pending",
      },
      {
        tool: "update_sheet",
        summary:
          "Add Item, Quantity, Unit price, and Total columns, with initial expense rows.",
        arguments: {
          sheetId: "$0.sheet.id",
          columns: [
            { id: "item", name: "Item", type: "text" },
            { id: "quantity", name: "Quantity", type: "number" },
            { id: "price", name: "Unit price", type: "currency" },
            { id: "total", name: "Total", type: "formula" },
          ],
          rows: [
            {
              cells: {
                item: "Hosting",
                quantity: "1",
                price: "25",
                total: "=B1*C1",
              },
            },
          ],
        },
        status: "pending",
      },
    ],
  };
  let themeMode = "light";
  let receiptMode = false;
  let deleted = false;
  // A chat sent from the quick prompt, served separately from chat_audit.
  let quickMode = false;
  let quick = null;
  const receiptSheets = [
    {
      id: "sheet_audit",
      title: "Expenses",
      workspaceId: "workspace",
      projectId: "project_audit",
    },
  ];
  const receipt = {
    merchant: "Corner Shop",
    date: "2026-09-29",
    currency: "JPY",
    category: "Groceries",
    subtotal: "300",
    tax: "30",
    tip: "",
    discount: "",
    total: "330",
    taxIncluded: false,
    items: [
      {
        description: "Rice",
        quantity: "1",
        unitPrice: "100",
        amount: "100",
        category: "Groceries",
      },
      {
        description: "Tea",
        quantity: "2",
        unitPrice: "100",
        amount: "200",
        category: "Groceries",
      },
    ],
    issues: [],
  };
  const image = {
    id: "img_audit",
    name: "Receipt.png",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const receiptContext = await browser.newContext();
  const receiptPage = await receiptContext.newPage();
  await receiptPage.setContent(
    `<html><body style="margin:0;padding:44px;background:#fff;color:#111;font:22px monospace;width:412px"><h1 style="font-size:30px;text-align:center">CORNER SHOP</h1><p style="text-align:center">TEST RECEIPT · JPY<br>2026-09-29</p><hr><p>Rice &nbsp;&nbsp;1 × 100 &nbsp;&nbsp;100</p><p>Tea &nbsp;&nbsp;&nbsp;2 × 100 &nbsp;&nbsp;200</p><hr><p>Subtotal &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;300</p><p>Tax (10%) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;30</p><h2 style="font-size:26px">TOTAL JPY &nbsp;&nbsp;&nbsp;&nbsp;330</h2><p style="text-align:center;font-size:14px">Synthetic receipt for testing</p></body></html>`,
  );
  await receiptPage.setViewportSize({ width: 500, height: 600 });
  await receiptPage.screenshot({ path: "/tmp/timely-receipt-fixture.png" });
  await receiptContext.close();
  const requests = [];
  await page.route("**/api-proxy/**", async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    let payload = null;
    try {
      payload = route.request().postDataJSON();
    } catch {}
    if (url.pathname.includes("/chats/images")) {
      if (route.request().method() === "POST")
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(image),
        });
      if (route.request().method() === "DELETE")
        return route.fulfill({ status: 204 });
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: fs.readFileSync("/tmp/timely-receipt-fixture.png"),
      });
    }
    if (
      receiptMode &&
      url.pathname.endsWith("/chats") &&
      route.request().method() === "POST"
    ) {
      chat.title = "Receipt expenses";
      chat.context = [
        { kind: "workspace", label: "Personal", value: "workspace" },
        { kind: "object", label: "Expenses", value: "sheets/sheet_audit" },
        {
          kind: "sheet-tab",
          label: "Current sheet tab",
          value: "sheets/sheet_audit/tabs/travel",
        },
      ];
      chat.status = "idle";
      chat.phase = "review";
      chat.sensitive = true;
      chat.plan = [];
      chat.revision = 10;
      chat.images = [image];
      chat.messages = [
        {
          id: "receipt-msg",
          role: "user",
          content: payload.content || "Process these images",
          imageIds: payload.imageIds,
        },
      ];
      chat.imageReview = {
        imageIds: [image.id],
        receiptId: "receipt-audit",
        status: "review",
        receipt,
        duplicates: [],
        text: "Corner Shop receipt",
      };
    }
    if (receiptMode && url.pathname.endsWith("/receipt")) {
      chat.imageReview.receipt = payload.receipt;
      chat.imageReview.destination = payload.destination;
      chat.status = "approval";
      chat.revision++;
      chat.plan = [
        {
          tool: "update_sheet",
          summary: "Save one JPY 330 receipt and both individual items",
          arguments: { sheetId: "sheet_audit" },
          status: "pending",
        },
      ];
    }
    if (receiptMode && url.pathname.endsWith("/approve")) {
      chat.imageReview.status = "confirmed";
      chat.images = [{ ...image, deletedAt: new Date().toISOString() }];
      chat.status = "idle";
      chat.revision++;
      chat.plan = chat.plan.map((x) => ({ ...x, status: "done" }));
    }
    requests.push({
      path: url.pathname,
      method: route.request().method(),
      body: payload,
    });
    if (url.pathname.endsWith("/read")) chat.unread = false;
    if (
      quickMode &&
      url.pathname.endsWith("/chats") &&
      route.request().method() === "POST"
    ) {
      quick = {
        ...chat,
        id: "chat_quick",
        title: "Plan my week",
        status: "running",
        phase: "",
        unread: false,
        plan: [],
        revision: 1,
        messages: [{ id: "q1", role: "user", content: payload.content }],
      };
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(quick),
      });
    }
    if (quick && url.pathname.includes("/chats/chat_quick"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(quick),
      });
    if (
      route.request().method() === "PATCH" &&
      url.pathname.endsWith("/chat_audit")
    ) {
      Object.assign(chat, route.request().postDataJSON());
      chat.revision++;
    }
    if (url.pathname.endsWith("/chat_audit/reject")) {
      chat.messages.push({
        id: "archive",
        role: "assistant",
        kind: "archive",
        content: "Discarded changes",
        createdAt: new Date().toISOString(),
        steps: chat.plan.map((x) => ({ ...x, status: "discarded" })),
      });
      chat.messages.push({
        id: "notice",
        role: "assistant",
        kind: "notice",
        content: "Proposal discarded. Nothing was changed.",
        createdAt: new Date().toISOString(),
      });
      chat.plan = [];
      chat.status = "idle";
      chat.revision++;
    }
    if (
      route.request().method() === "DELETE" &&
      url.pathname.endsWith("/chat_audit")
    ) {
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    if (url.pathname.endsWith("/chats"))
      body =
        route.request().method() === "POST"
          ? chat
          : deleted
            ? []
            : quick
              ? [quick, chat]
              : [chat];
    else if (receiptMode && url.pathname.endsWith("/workspaces"))
      body = [{ id: "workspace", name: "Personal" }];
    else if (receiptMode && url.pathname.endsWith("/sheets"))
      body = receiptSheets;
    else if (receiptMode && url.pathname.endsWith("/sheets/sheet_audit"))
      body = {
        id: "sheet_audit",
        title: "Expenses",
        workspaceId: "workspace",
        tabs: [
          { id: "items", name: "Items", columns: [], rows: [] },
          { id: "expenses", name: "Expenses", columns: [], rows: [] },
          { id: "travel", name: "Travel", columns: [], rows: [] },
        ],
      };
    else if (url.pathname.includes("/chats/chat_audit")) body = chat;
    else if (url.pathname.endsWith("/agent/providers"))
      body = {
        defaultProvider: "openrouter",
        localCli: false,
        openrouter: {
          keySet: true,
          chatModel: "audit/default-model",
          embedModel: "",
          ready: true,
        },
        claude: {
          enabled: false,
          status: {},
          connected: false,
          model: "",
          ready: false,
        },
        codex: {
          enabled: false,
          status: {},
          connected: false,
          model: "",
          ready: false,
        },
        apiProviders: [],
        reindex: { done: 0, total: 0, updatedAt: "" },
      };
    else if (url.pathname.endsWith("/config"))
      body = { appearance: { theme: themeMode, accent: "default" } };
    else if (url.pathname.endsWith("/me"))
      body = {
        id: "ui-user",
        name: "Design review",
        email: "audit@example.invalid",
        is_on_boarding_completed: true,
      };
    else if (url.pathname.includes("unread-count")) body = { count: 1 };
    else body = [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("http://localhost:4002/chat");
  await page.getByRole("heading", { name: "What would you like" }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({ path: "/tmp/timely-chat-empty.png", fullPage: true });
  // Clicking a history row opens that conversation.
  await page
    .getByRole("button", { name: "Open Build a project budget" })
    .click();
  await page.waitForURL(/\/chat\?id=chat_audit/);
  await page.getByRole("button", { name: "Apply changes" }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "/tmp/timely-chat-proposal.png",
    fullPage: true,
  });
  await page.getByText("Review details", { exact: true }).nth(1).click();
  await page.getByRole("cell", { name: "Hosting", exact: true }).waitFor();
  await page.getByRole("button", { name: "Web search", exact: true }).click();
  await page.waitForTimeout(200);
  assert(
    requests.some((r) => r.method === "PATCH" && r.body.webSearch === true),
    "search toggle was not saved",
  );
  const approvalRevision = chat.revision;
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await page.waitForTimeout(200);
  assert(
    requests.some(
      (r) =>
        r.path.endsWith("/approve") && r.body.revision === approvalRevision,
    ),
    "approval did not bind to the displayed revision",
  );
  // Failed steps are named, and retry resets them.
  const originalPlan = JSON.parse(JSON.stringify(chat.plan));
  chat.status = "failed";
  chat.error = "Sheet name already exists";
  chat.plan[0].status = "done";
  chat.plan[1].status = "failed";
  chat.plan[1].error = "Sheet name already exists";
  await page.reload();
  await page.getByText("Some changes did not finish").waitFor();
  await page
    .getByRole("alert")
    .getByText("Sheet name already exists")
    .first()
    .waitFor();
  await page.getByLabel("Failed", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Review unfinished changes" })
    .waitFor();
  chat.status = "approval";
  chat.error = "";
  chat.plan[1].status = "pending";
  delete chat.plan[1].error;
  // Discarding a proposal archives it and keeps the conversation usable.
  await page.reload();
  const rejectRevision = chat.revision;
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByText("Proposal discarded. Nothing was changed.").waitFor();
  await page.getByRole("button", { name: /Discarded proposal/ }).click();
  await page.getByLabel("Discarded", { exact: true }).first().waitFor();
  assert(
    requests.some(
      (r) => r.path.endsWith("/reject") && r.body.revision === rejectRevision,
    ),
    "discard did not bind to the displayed revision",
  );
  await expect(
    page.getByRole("button", { name: "Apply changes", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "/tmp/timely-chat-discarded.png",
    fullPage: true,
  });
  // History rows rename inline and delete through the shared confirmation.
  await page
    .getByRole("button", { name: "More options for Build a project budget" })
    .click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Conversation title").fill("Budget planning");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Budget planning" }).waitFor();
  assert(
    requests.some(
      (r) => r.method === "PATCH" && r.body.title === "Budget planning",
    ),
    "rename was not saved",
  );
  await page
    .getByRole("button", { name: "More options for Budget planning" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("heading", { name: "What would you like" }).waitFor();
  assert(
    requests.some(
      (r) => r.method === "DELETE" && r.path.endsWith("/chat_audit"),
    ),
    "delete was not sent",
  );
  await page.getByText("Your conversations will live here.").waitFor();
  deleted = false;
  chat.title = "Build a project budget";
  chat.messages = chat.messages.slice(0, 2);
  chat.plan = JSON.parse(JSON.stringify(originalPlan));
  chat.status = "approval";
  chat.revision = 2;
  await page.goto("http://localhost:4002/chat?id=chat_audit");
  await page.getByRole("button", { name: "Apply changes" }).waitFor();
  // Motion on, so the island's morph and bounce run (Reduce motion defaults on).
  await page.evaluate(() =>
    localStorage.setItem("timely.reducedMotion", "false"),
  );
  await page.reload();
  await page.getByRole("button", { name: "Apply changes" }).waitFor();
  await page.keyboard.press("Control+Shift+J");
  const overlay = page.getByRole("dialog", { name: "Chat with Timely" });
  await overlay.waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "/tmp/timely-chat-overlay.png",
    fullPage: true,
  });
  // The quick prompt opens as a bare bar: no header, hero or sample prompts.
  await expect(overlay.getByRole("heading")).toHaveCount(0);
  await expect(overlay.getByText("New conversation")).toHaveCount(0);
  await expect(overlay.getByLabel("Conversation messages")).toHaveCount(0);
  await expect(overlay.getByLabel("Message Timely")).toBeFocused();
  await overlay.getByRole("button", { name: /Remove .* context/ }).click();
  assert.equal(
    await overlay.getByRole("button", { name: /Remove .* context/ }).count(),
    0,
  );
  await overlay.getByRole("button", { name: /Default/ }).click();
  await overlay.getByRole("dialog", { name: "Choose a model" }).waitFor();
  const bar = await overlay.boundingBox();
  const menu = await overlay
    .getByRole("dialog", { name: "Choose a model" })
    .boundingBox();
  assert(menu.y < bar.y, "model menu should open above the prompt bar");
  assert(
    bar.y + bar.height > page.viewportSize().height * 0.85,
    "prompt bar should sit near the bottom of the screen",
  );
  await page.screenshot({
    path: "/tmp/timely-chat-overlay-models.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(
    overlay.getByRole("dialog", { name: "Choose a model" }),
  ).toHaveCount(0);
  await expect(overlay).toBeVisible();
  // Sending shrinks the prompt into the Activity island above Sign out.
  marks.islandStart = (Date.now() - videoStart) / 1000;
  quickMode = true;
  await overlay.getByLabel("Message Timely").fill("Plan my week");
  await page.keyboard.press("Enter");
  await expect(overlay).toHaveCount(0);
  const island = page.locator("[data-activity-island]");
  await expect(island).toBeVisible();
  const islandBox = await island.boundingBox();
  const signOut = await page
    .getByRole("button", { name: "Sign out" })
    .boundingBox();
  assert(islandBox.x < 70, "island should sit in the sidebar");
  assert(
    islandBox.y < signOut.y && signOut.y - islandBox.y < 80,
    "island should sit right above Sign out",
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/timely-island-working.png" });
  // When the run finishes, the pill bounces and keeps an attention dot.
  await page.evaluate(() => {
    window.__islandMoves = [];
    const target = document.querySelector(
      "[data-activity-island]",
    ).parentElement;
    const watch = () => {
      const t = getComputedStyle(target).transform;
      if (t !== "none") window.__islandMoves.push(t);
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  quick.status = "idle";
  quick.unread = true;
  quick.revision++;
  quick.messages.push({
    id: "q2",
    role: "assistant",
    content: "Here is a plan for your week.",
  });
  await expect(page.locator("[data-activity-attention]")).toHaveCount(0);
  await expect(page.locator("[data-activity-attention]")).toBeVisible({
    timeout: 12000,
  });
  await page.waitForTimeout(300);
  const moves = await page.evaluate(() => window.__islandMoves);
  assert(
    moves.some(
      (t) => t.startsWith("matrix") && parseFloat(t.split(",")[5]) < -2,
    ),
    `island did not bounce: ${JSON.stringify(moves.slice(0, 5))}`,
  );
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/timely-island-done.png" });
  // Opening springs: the panel overshoots its final size before settling.
  await page.evaluate(() => {
    window.__islandScales = [];
    const watch = () => {
      const panel = document.querySelector(
        '[role="dialog"][aria-label="Activity"]',
      );
      const t = panel && getComputedStyle(panel).transform;
      if (t && t.startsWith("matrix"))
        window.__islandScales.push(parseFloat(t.slice(7)));
      if (window.__islandScales.length < 120) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await island.click();
  const activity = page.getByRole("dialog", { name: "Activity" });
  await activity.waitFor();
  await page.waitForTimeout(900);
  const scales = await page.evaluate(() => window.__islandScales);
  assert(
    scales.some((x) => x > 1.005),
    `island did not spring open: ${JSON.stringify(scales.slice(0, 12))}`,
  );
  await expect(activity.getByText("Plan my week")).toBeVisible();
  await expect(activity.getByText("Build a project budget")).toBeVisible();
  await activity.getByText("Build a project budget").hover();
  // Dismiss sits inside its row's highlight, not beside it.
  const row = await activity
    .locator("li", { hasText: "Build a project budget" })
    .boundingBox();
  const x = await activity
    .getByRole("button", { name: "Dismiss Build a project budget" })
    .boundingBox();
  assert(
    x.x + x.width <= row.x + row.width - 4,
    "dismiss button should sit inside the row",
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/timely-island-open.png" });
  await page.mouse.move(700, 500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
  await island.click();
  await activity.waitFor();
  await page.waitForTimeout(700);
  marks.islandEnd = (Date.now() - videoStart) / 1000;
  await activity.getByRole("button", { name: /^Plan my week/ }).click();
  await overlay.getByLabel("Conversation messages").waitFor();
  await overlay.getByRole("button", { name: "Open in Chat tab" }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "/tmp/timely-chat-overlay-sent.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  quickMode = false;
  quick = null;
  await page.keyboard.press("Control+Shift+J");
  await overlay.waitFor();
  await page.mouse.click(20, 980);
  if (await page.getByRole("dialog").count())
    throw new Error("Clicking outside failed to close overlay");
  themeMode = "dark";
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.reload();
  await page.getByRole("button", { name: "Apply changes" }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({ path: "/tmp/timely-chat-dark.png", fullPage: true });
  await page.locator("[data-activity-island]").click();
  await page.getByRole("dialog", { name: "Activity" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/timely-island-dark.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Activity" })).toHaveCount(0);
  receiptMode = true;
  themeMode = "light";
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("http://localhost:4002/chat");
  await page
    .getByLabel("Upload images")
    .setInputFiles("/tmp/timely-receipt-fixture.png");
  await page.getByRole("button", { name: "Remove Receipt.png" }).waitFor();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("heading", { name: "Review your receipt" }).waitFor();
  assert.equal(await page.getByLabel("Item 2 amount").inputValue(), "200");
  await expect(page.getByLabel("Expense sheet", { exact: true })).toHaveValue(
    "sheet_audit",
  );
  await expect(
    page.getByLabel("Expense summary tab", { exact: true }),
  ).toHaveValue("travel");
  // Manual overrides remain authoritative, including creating a new sheet.
  await page.getByLabel("Expense sheet", { exact: true }).selectOption("");
  await expect(page.getByLabel("Receipt workspace")).toHaveValue("workspace");
  await page.getByLabel("Merchant", { exact: true }).fill("Edited shop");
  await expect(page.getByLabel("Expense sheet", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel("Expense sheet", { exact: true })
    .selectOption("sheet_audit");
  await page
    .getByLabel("Expense summary tab", { exact: true })
    .selectOption("expenses");
  await page.screenshot({
    path: "/tmp/timely-receipt-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review sheet changes" }).click();
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .waitFor();
  await page.getByLabel("Merchant", { exact: true }).fill("Corrected shop");
  assert(
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .isDisabled(),
    "edited draft can apply stale proposal",
  );
  await page.getByRole("button", { name: "Review sheet changes" }).click();
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await page
    .getByText("Image removed · extracted details kept")
    .first()
    .waitFor();
  assert(
    requests.some(
      (r) =>
        r.path.endsWith("/receipt") &&
        r.body.receipt.merchant === "Corrected shop" &&
        r.body.destination.sheetId === "sheet_audit" &&
        r.body.destination.expenseTabId === "expenses",
    ),
    "receipt correction was not submitted",
  );
  chat.context = [{ kind: "workspace", label: "Personal", value: "workspace" }];
  chat.imageReview.status = "review";
  delete chat.imageReview.destination;
  chat.status = "idle";
  chat.phase = "review";
  chat.plan = [];
  await page.reload();
  await expect(page.getByLabel("Expense sheet", { exact: true })).toHaveValue(
    "sheet_audit",
  );
  await expect(
    page.getByLabel("Expense summary tab", { exact: true }),
  ).toHaveValue("expenses");
  // Standalone chat must also find the single existing Expense sheet.
  chat.context = [];
  receiptSheets[0].title = "Expense";
  await page.reload();
  await expect(
    page.getByLabel("Expense sheet", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await expect(page.getByLabel("Expense sheet", { exact: true })).toHaveValue(
    "sheet_audit",
  );
  chat.context = [{ kind: "workspace", label: "Personal", value: "workspace" }];
  receiptSheets.push({
    id: "other_sheet",
    title: "Travel expenses",
    workspaceId: "workspace",
    projectId: "other_project",
  });
  await page.reload();
  await expect(
    page.getByLabel("Expense sheet", { exact: true }).locator("option"),
  ).toHaveCount(3);
  await expect(page.getByLabel("Expense sheet", { exact: true })).toHaveValue(
    "",
  );
  // A project narrows otherwise ambiguous workspace matches.
  chat.context.push({
    kind: "project",
    label: "Current project",
    value: "project_audit",
  });
  await page.reload();
  await expect(page.getByLabel("Expense sheet", { exact: true })).toHaveValue(
    "sheet_audit",
  );
  chat.context = [];
  await page.reload();
  await expect(
    page.getByLabel("Expense sheet", { exact: true }).locator("option"),
  ).toHaveCount(3);
  await expect(page.getByLabel("Expense sheet", { exact: true })).toHaveValue(
    "",
  );
  chat.imageReview.receipt = { ...receipt, items: [] };
  await page.reload();
  await expect(
    page.getByText("No individual items were extracted.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Item 1 description")).toHaveCount(0);
  await expect(
    page.getByText("We’ll save one summary item using", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Expense sheet", { exact: true })
    .selectOption("sheet_audit");
  await page.getByRole("button", { name: "Review sheet changes" }).click();
  assert(
    requests.some(
      (r) =>
        r.path.endsWith("/receipt") &&
        r.body.receipt.items.length === 0 &&
        r.body.receipt.total === "330",
    ),
    "summary-only receipt was not submitted",
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify({
      errors,
      marks,
      screenshots: [
        "/tmp/timely-chat-empty.png",
        "/tmp/timely-chat-proposal.png",
        "/tmp/timely-chat-overlay.png",
        "/tmp/timely-chat-overlay-models.png",
        "/tmp/timely-chat-overlay-sent.png",
        "/tmp/timely-island-working.png",
        "/tmp/timely-island-done.png",
        "/tmp/timely-island-open.png",
        "/tmp/timely-island-dark.png",
        "/tmp/timely-chat-discarded.png",
        "/tmp/timely-receipt-review.png",
      ],
    }),
  );
  await browser.close();
})();

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exit(1);
});
