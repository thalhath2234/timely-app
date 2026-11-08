const { chromium, expect } = require("@playwright/test");
// A plan of several changes applies them all from the footer, or one by one.
const APPLY_ALL = /^Apply (all|changes)$/;
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
  // A bot proposal (create_bot with the server's reading of the page).
  const shopRead = {
    index: 0,
    watchId: "",
    ok: true,
    kind: "page",
    read: "product_price",
    site: "amazon.in",
    summary: "₹19,999",
    value: 19999,
    currency: "INR",
    text: "",
    items: null,
    excerpt: {
      text: "Google Pixel Buds Pro 2 Wireless Earbuds … M.R.P.: Rs 22,900 Deal Price: Rs 19,999 (13% off) Inclusive of all taxes",
      mark: [73, 82],
      struck: [[51, 60]],
    },
    candidates: [
      {
        label: "Deal Price",
        amount: 19999,
        currency: "INR",
        selector: "span.a-price-whole",
        struck: false,
        from: "text",
      },
      {
        label: "M.R.P.",
        amount: 22900,
        currency: "INR",
        selector: "span.a-text-price",
        struck: true,
        from: "text",
      },
    ],
    health: null,
    at: new Date().toISOString(),
  };
  const feedRead = {
    index: 1,
    watchId: "",
    ok: true,
    kind: "feed",
    read: "",
    site: "go.dev",
    summary: "3 posts",
    value: null,
    currency: "",
    text: "",
    items: [
      {
        title: "Go 1.25 is released",
        url: "https://go.dev/blog/go1.25",
        publishedAt: null,
      },
    ],
    excerpt: null,
    candidates: null,
    health: null,
    at: new Date().toISOString(),
  };
  const shopWatch = {
    kind: "page",
    url: "https://www.amazon.in/dp/B0DFC8QZ4M",
    read: "product_price",
    rules: [{ kind: "below", threshold: 18000 }],
  };
  const feedWatch = { kind: "feed", url: "https://go.dev/blog/feed.atom" };
  const botStep = (watches, preview) => ({
    tool: "create_bot",
    summary: "Make a bot that watches the earbuds' price",
    arguments: {
      name: "Pixel Buds Pro 2 under ₹18,000",
      description: "tell me when these earbuds drop under 18,000 on Amazon",
      intervalMinutes: 0,
      watches,
    },
    status: "pending",
    preview,
  });
  const botChat = {
    ...chat,
    id: "chat_bot",
    title: "Earbuds price watch",
    status: "approval",
    phase: "review",
    unread: false,
    revision: 4,
    context: [],
    messages: [
      {
        id: "b1",
        createdAt: new Date().toISOString(),
        role: "user",
        content:
          "tell me when these earbuds drop under 18,000 on Amazon amazon.in/dp/B0DFC8QZ4M",
      },
      {
        id: "b2",
        createdAt: new Date().toISOString(),
        role: "assistant",
        content:
          "I opened the page once to find the price. Here’s a bot that checks it every 6 hours and tells you once when it goes under ₹18,000. If I picked the wrong number, say “That’s not it”.",
      },
    ],
    plan: [botStep([shopWatch], { watches: [shopRead] })],
  };
  // Bots for the composer's @-picker, and answers of tagged bots.
  const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const botView = (id, name, watch, over = {}) => ({
    id,
    name,
    description: "",
    status: "active",
    pauseReason: null,
    origin: "app",
    originClient: "",
    judgeMode: "rules",
    intervalMinutes: 60,
    urgent: false,
    desktop: true,
    phone: true,
    snoozedUntil: null,
    nextCheckAt: ago(-30),
    lastCheckAt: ago(12),
    lastOkAt: ago(12),
    strikes: 0,
    health: { code: "working", line: "" },
    alertsToday: 0,
    watches: [
      {
        id: `${id}_w`,
        url: "",
        read: "",
        selector: "",
        source: "",
        symbol: "",
        currency: "",
        rules: [],
        health: { code: "working", line: "" },
        lastReadingAt: ago(12),
        summary: "",
        site: "",
        title: "",
        value: null,
        excerpt: "",
        latestItem: null,
        lastChangedAt: null,
        spark: null,
        dayChangePct: null,
        ...watch,
      },
    ],
    createdAt: ago(60 * 24 * 9),
    updatedAt: ago(60),
    checking: false,
    runNowAt: null,
    floorLine: "",
    strip: "nnnn",
    latestAlert: null,
    itemsToday: 0,
    ...over,
  });
  const tagBots = [
    botView("bot_gonews", "Go news feed", { kind: "feed", site: "go.dev" }),
    botView(
      "bot_gorelease",
      "Go release news",
      { kind: "feed", site: "go.dev" },
      { status: "paused", updatedAt: ago(60 * 24 * 5) },
    ),
    botView("bot_gpu", "GPU deals under $400", {
      kind: "feed",
      site: "reddit.com",
    }),
    botView("bot_btc", "Bitcoin under $70,000", {
      kind: "price",
      source: "coinbase",
      symbol: "BTC",
      currency: "USD",
    }),
  ];
  const answer = (bot, fresh, freshLine, over = {}) => ({
    bot: {
      id: bot.id,
      name: bot.name,
      status: bot.status,
      pauseReason: bot.pauseReason,
      health: bot.health,
    },
    fresh,
    freshLine,
    checkedAt: ago(1),
    nextCheckAt: ago(-55),
    watches: [],
    findings: [],
    alertsToday: 0,
    ...over,
  });
  const goFeed = {
    id: "bot_gonews_w",
    kind: "feed",
    site: "go.dev",
    title: "go.dev · Feed",
    summary: "12 posts",
    value: null,
    currency: "",
    excerpt: "",
    items: [
      {
        title: "Go 1.26 is released",
        url: "https://go.dev/blog/go1.26",
        publishedAt: ago(60 * 26),
      },
    ],
    lastChangedAt: ago(60 * 26),
  };
  const tagChat = {
    ...chat,
    id: "chat_tag",
    title: "Go news this week",
    status: "idle",
    phase: "review",
    unread: false,
    revision: 6,
    context: [],
    plan: [],
    messages: [
      {
        id: "t1",
        createdAt: ago(9),
        role: "user",
        content: "@Go news feed anything new this week?",
        botTags: ["bot_gonews"],
      },
      {
        id: "t2",
        createdAt: ago(8),
        role: "assistant",
        content:
          "Yes: Go 1.26 came out yesterday. That is the only new post this week.",
        botAnswers: [
          answer(tagBots[0], "checked_now", "Checked just now", {
            watches: [goFeed],
            alertsToday: 1,
            findings: [
              {
                id: "fnd_1",
                botId: "bot_gonews",
                checkId: null,
                watchId: "bot_gonews_w",
                kind: "item",
                title: "Go 1.26 is released",
                why: "A new post in the feed",
                url: "https://go.dev/blog/go1.26",
                price: null,
                currency: "",
                changePct: null,
                urgency: "normal",
                outsideData: true,
                alerted: true,
                digestedAt: null,
                createdAt: ago(60 * 26),
              },
            ],
          }),
        ],
      },
      {
        id: "t3",
        createdAt: ago(4),
        role: "user",
        content: "@GPU deals under $400 @Go release news what do you see?",
        botTags: ["bot_gpu", "bot_gorelease"],
      },
      {
        id: "t4",
        createdAt: ago(3),
        role: "assistant",
        content:
          "The GPU deals bot is checking now, so its newest posts show on the bot in a moment. Go release news is paused; its last reading is from Nov 2.",
        botAnswers: [
          answer(
            tagBots[2],
            "waiting",
            "Checking now; the result shows on the bot",
            {
              watches: [
                {
                  ...goFeed,
                  id: "bot_gpu_w",
                  site: "reddit.com",
                  title: "reddit.com · Feed",
                  summary: "40 posts",
                  items: [],
                  excerpt: "RTX 4070 Super, $389 at Newegg",
                },
                {
                  ...goFeed,
                  id: "bot_gpu_w2",
                  site: "slickdeals.net",
                  title: "slickdeals.net · Feed",
                  summary: "25 posts",
                  items: [],
                  excerpt: "",
                },
              ],
            },
          ),
          answer(tagBots[1], "paused", "Paused, so this is from Nov 2", {
            nextCheckAt: null,
            watches: [{ ...goFeed, id: "bot_gorelease_w", summary: "8 posts" }],
          }),
        ],
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
    if (url.pathname.includes("/chats/chat_tag")) {
      requests.push({
        path: url.pathname,
        method: route.request().method(),
        body: payload,
      });
      if (url.pathname.endsWith("/messages"))
        tagChat.messages.push({
          id: `t${tagChat.messages.length + 1}`,
          createdAt: new Date().toISOString(),
          role: "user",
          content: payload.content,
          botTags: payload.botTags,
        });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(tagChat),
      });
    }
    if (url.pathname.endsWith("/bots") && route.request().method() === "GET")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bots: tagBots,
          summary: { checksToday: 12, alertsToday: 1, nextCheckAt: ago(-30) },
        }),
      });
    if (url.pathname.includes("/chats/chat_bot")) {
      requests.push({
        path: url.pathname,
        method: route.request().method(),
        body: payload,
      });
      if (url.pathname.endsWith("/messages")) {
        botChat.messages.push({
          id: `b${botChat.messages.length + 1}`,
          role: "user",
          content: payload.content,
        });
        botChat.status = "queued";
        botChat.revision++;
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(botChat),
      });
    }
    if (url.pathname.endsWith("/bots/defaults"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ desktop: true, phone: true, urgent: false }),
      });
    if (url.pathname.endsWith("/bots/icons"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ icons: {} }),
      });
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
  await page.getByRole("button", { name: APPLY_ALL }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "/tmp/timely-chat-proposal.png",
    fullPage: true,
  });
  // One card is open at a time; the second shows the rows it adds as a table.
  await page
    .getByRole("button", { name: /Add Item, Quantity, Unit price/ })
    .click();
  await page.getByRole("cell", { name: "Hosting", exact: true }).waitFor();
  await page.getByRole("button", { name: "Web search", exact: true }).click();
  await page.waitForTimeout(200);
  assert(
    requests.some((r) => r.method === "PATCH" && r.body.webSearch === true),
    "search toggle was not saved",
  );
  const approvalRevision = chat.revision;
  await page.getByRole("button", { name: APPLY_ALL }).click();
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
  await page.getByText("Failed", { exact: true }).first().waitFor();
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
  await page.getByRole("button", { name: "Discard all", exact: true }).click();
  await page.getByText("Proposal discarded. Nothing was changed.").waitFor();
  await page.getByRole("button", { name: /Discarded proposal/ }).click();
  await page.getByText("Discarded", { exact: true }).first().waitFor();
  assert(
    requests.some(
      (r) => r.path.endsWith("/reject") && r.body.revision === rejectRevision,
    ),
    "discard did not bind to the displayed revision",
  );
  await expect(page.getByRole("button", { name: APPLY_ALL })).toHaveCount(0);
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
  await page.getByRole("button", { name: APPLY_ALL }).waitFor();
  // Motion on, so the island's morph and bounce run (Reduce motion defaults on).
  await page.evaluate(() =>
    localStorage.setItem("timely.reducedMotion", "false"),
  );
  await page.reload();
  await page.getByRole("button", { name: APPLY_ALL }).waitFor();
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
  await page.getByRole("button", { name: APPLY_ALL }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({ path: "/tmp/timely-chat-dark.png", fullPage: true });
  await page.locator("[data-activity-island]").click();
  await page.getByRole("dialog", { name: "Activity" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/timely-island-dark.png" });
  // Keyboard: opening focuses Close, Esc hands focus back to the pill.
  await expect(
    page.getByRole("button", { name: "Close activity" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Activity" })).toHaveCount(0);
  await expect(page.locator("[data-activity-island]")).toBeFocused();
  // Dismissing a chat that waits for review hides it until it changes.
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Dismiss Build a project budget" })
    .click();
  await expect(page.locator("[data-activity-island]")).toHaveCount(0);
  // A bot proposal: grouped rows, how it lands on the board, what it reads
  // right now, and "That's not it" with the other prices on the page.
  themeMode = "light";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://localhost:4002/chat?id=chat_bot");
  const proposal = page.getByRole("region", { name: "Proposed changes" });
  await proposal
    .getByRole("heading", { name: "New bot", exact: true })
    .waitFor();
  await proposal.getByText("Needs your OK").first().waitFor();
  for (const text of [
    "amazon.in · Product price",
    "6 hours",
    "Price is below ₹18,000",
    "Rules only",
    "Desktop, Phone",
    "Read once in chat",
    "On approve",
    "3 alerts a day",
  ])
    await proposal.getByText(text, { exact: true }).first().waitFor();
  await proposal.getByText("Right now it reads: ₹19,999").first().waitFor();
  await expect(proposal.locator("mark")).toHaveText("Rs 19,999");
  await expect(proposal.locator("s").first()).toHaveText("Rs 22,900");
  await expect(proposal.getByRole("progressbar")).toBeHidden();
  await expect(
    proposal.getByText("To adjust, just reply below", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Message Timely")).toHaveAttribute(
    "placeholder",
    "Reply, or ask for changes to the bot",
  );
  await page.getByRole("button", { name: "Approve", exact: true }).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({ path: "/tmp/timely-chat-bot.png", fullPage: true });
  await proposal.getByRole("button", { name: "That’s not it" }).click();
  const notIt = page.getByRole("dialog", {
    name: "Which price should it follow?",
  });
  await notIt.waitFor();
  await notIt.getByText("What it reads now").first().waitFor();
  await page.screenshot({
    path: "/tmp/timely-chat-bot-not-it.png",
    fullPage: true,
  });
  await notIt.getByRole("button", { name: /^Follow M\.R\.P\./ }).click();
  await page.waitForTimeout(200);
  assert(
    requests.some(
      (r) =>
        r.path.endsWith("/chat_bot/messages") &&
        r.body.content ===
          'That\'s not it. Follow the “M.R.P.”, ₹22,900, on the amazon.in watch (selector "span.a-text-price").',
    ),
    "That's not it did not send the picked price",
  );
  // Two watches: each rule sits under its watch's name.
  botChat.status = "approval";
  botChat.plan = [
    botStep([shopWatch, feedWatch], { watches: [shopRead, feedRead] }),
  ];
  await page.reload();
  await proposal.getByText("Watch 2", { exact: true }).first().waitFor();
  // The watch row, its rules' sub-label and its reading's name.
  await expect(
    proposal.getByText("go.dev · Feed", { exact: true }).nth(2),
  ).toBeVisible();
  await proposal.getByText("A new post", { exact: true }).first().waitFor();
  await proposal.getByText("Right now it reads: 3 posts").first().waitFor();
  await proposal.getByText("Go 1.25 is released").first().waitFor();
  await page.screenshot({
    path: "/tmp/timely-chat-bot-two.png",
    fullPage: true,
  });
  // A feed has no other prices: "That's not it" starts a reply in words.
  await proposal
    .getByRole("region", { name: "What go.dev · Feed reads" })
    .getByRole("button", { name: "That’s not it" })
    .click();
  await expect(page.getByLabel("Message Timely")).toHaveValue(
    "That’s not it: ",
  );
  await expect(page.getByLabel("Message Timely")).toBeFocused();
  // A reading that failed shows why, and still lets the person say so.
  await page.getByLabel("Message Timely").fill("");
  botChat.plan = [
    botStep([shopWatch], { error: "The site asks not to be read" }),
  ];
  await page.reload();
  await proposal.getByText("The site asks not to be read").first().waitFor();
  await expect(proposal.getByText(/^Right now it reads/)).toHaveCount(0);
  await proposal.getByRole("button", { name: "That’s not it" }).click();
  await expect(page.getByLabel("Message Timely")).toHaveValue(
    "That’s not it: ",
  );
  await page.getByLabel("Message Timely").fill("");
  // Dark theme, a failed read of one watch.
  themeMode = "dark";
  botChat.plan = [
    botStep([shopWatch], {
      watches: [
        {
          ...shopRead,
          ok: false,
          summary: "",
          excerpt: null,
          candidates: null,
          health: {
            code: "captcha",
            line: "The site showed a robot check instead of the page",
          },
        },
      ],
    }),
  ];
  await page.reload();
  await proposal
    .getByText("The site showed a robot check instead of the page")
    .first()
    .waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "/tmp/timely-chat-bot-dark.png",
    fullPage: true,
  });
  // A bot link proposal: update_bot with passesTo, the linked bot named
  // from the board, never by its id.
  themeMode = "light";
  botChat.status = "approval";
  botChat.plan = [
    {
      tool: "update_bot",
      summary: "Have Go release news check release posts first",
      arguments: {
        bot: "bot_gonews",
        passesTo: [{ bot: "bot_gorelease", filter: ["release"] }],
      },
      status: "pending",
      before: {
        id: "bot_gonews",
        name: "Go news feed",
        description: "",
        status: "active",
        intervalMinutes: 30,
        judgeMode: "rules",
        desktop: true,
        phone: true,
        urgent: false,
        watches: [
          {
            id: "bot_gonews_w",
            ...feedWatch,
            read: "",
            selector: "",
            source: "",
            symbol: "",
            currency: "",
            rules: [{ kind: "new_item" }],
          },
        ],
        passesTo: [],
      },
    },
  ];
  await page.reload();
  await proposal
    .getByRole("heading", { name: "Go news feed", exact: true })
    .waitFor();
  await proposal
    .getByText("Go release news · mentions release", { exact: true })
    .first()
    .waitFor();
  await expect(proposal.getByText("bot_gorelease")).toHaveCount(0);
  await expect(proposal.getByText(/^Right now it reads/)).toHaveCount(0);
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "/tmp/timely-chat-bot-link.png",
    fullPage: true,
  });
  // A brief proposal: create_bot kind brief sums up bots instead of
  // watching, sends daily, and reads no page.
  botChat.plan = [
    {
      tool: "create_bot",
      summary: "Make a morning brief",
      arguments: {
        name: "Morning brief",
        description: "Each morning, sum up what my other bots found.",
        intervalMinutes: 1440,
        kind: "brief",
        sources: ["bot_gonews", "bot_gpu"],
        briefTime: "08:00",
        watches: [],
      },
      status: "pending",
    },
  ];
  await page.reload();
  await proposal
    .getByRole("heading", { name: "Morning brief", exact: true })
    .waitFor();
  for (const text of [
    "Go news feed",
    "GPU deals under $400",
    "Daily at 08:00",
    "Timely",
    "Nothing yet",
    "The brief starts when you approve. It reads only what your bots found, never a page.",
  ])
    await proposal.getByText(text, { exact: true }).first().waitFor();
  await expect(proposal.getByText("Sums up", { exact: true })).toHaveCount(2);
  await expect(proposal.getByText("Checks every", { exact: true })).toHaveCount(
    0,
  );
  await expect(proposal.getByText("First check", { exact: true })).toHaveCount(
    0,
  );
  await expect(proposal.getByText(/^Right now it reads/)).toHaveCount(0);
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "/tmp/timely-chat-bot-brief.png",
    fullPage: true,
  });
  // Tagged bots: each answer as a card under the reply, fresh, still
  // checking, and paused.
  themeMode = "light";
  await page.goto("http://localhost:4002/chat?id=chat_tag");
  const goAnswer = page.getByRole("region", { name: "Go news feed answers" });
  await goAnswer.waitFor();
  for (const text of [
    "Checked just now · 1 alert today",
    "go.dev · Feed",
    "12 posts",
    "Found this week",
    "A new post in the feed",
  ])
    await goAnswer.getByText(text, { exact: true }).first().waitFor();
  await expect(
    goAnswer.getByRole("link", { name: "Open Go news feed" }),
  ).toHaveAttribute("href", "/bots?bot=bot_gonews");
  await page
    .getByRole("region", { name: "GPU deals under $400 answers" })
    .getByText("Checking now; the result shows on the bot")
    .waitFor();
  await page
    .getByRole("region", { name: "GPU deals under $400 answers" })
    .getByText("RTX 4070 Super, $389 at Newegg")
    .waitFor();
  const pausedAnswer = page.getByRole("region", {
    name: "Go release news answers",
  });
  await pausedAnswer.getByText("Paused, so this is from Nov 2").waitFor();
  await expect(pausedAnswer.getByText(/^Next check/)).toHaveCount(0);
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "/tmp/timely-chat-tag-answer.png",
    fullPage: true,
  });
  // The @-picker: the arrow keys and Enter pick inside the open list,
  // Escape closes it, a chip shows each tag, and a 4th tag is refused.
  const box = page.getByLabel("Message Timely");
  const picker = page.getByRole("listbox", { name: "Tag a bot" });
  await box.fill("Hi @go");
  await picker.waitFor();
  await expect(picker.getByRole("option")).toHaveText([
    /Go news feed/,
    /Go release news/,
  ]);
  await page.screenshot({ path: "/tmp/timely-chat-tag-picker.png" });
  await box.press("ArrowDown");
  await expect(
    picker.getByRole("option", { name: /^Go release news/ }),
  ).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(box).toHaveValue("Hi @Go release news ");
  await page
    .getByRole("button", { name: "Remove tag Go release news" })
    .waitFor();
  assert(
    !requests.some(
      (r) => r.path.endsWith("/chat_tag/messages") && r.method === "POST",
    ),
    "Enter in the picker sent the message",
  );
  await box.press("End");
  await box.pressSequentially("@");
  await picker.waitFor();
  await box.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(box).toBeVisible();
  await box.press("Backspace");
  await box.pressSequentially("@gp");
  await picker.getByRole("option", { name: /^GPU deals under \$400/ }).click();
  await box.pressSequentially("@bit");
  await picker.getByRole("option", { name: /^Bitcoin under/ }).click();
  await box.pressSequentially("@go");
  await picker.getByText("Tag up to 3 bots").waitFor();
  await page.screenshot({ path: "/tmp/timely-chat-tag-full.png" });
  for (let i = 0; i < 3; i++) await box.press("Backspace");
  await page
    .getByRole("button", { name: "Remove tag Bitcoin under $70,000" })
    .click();
  await expect(box).toHaveValue("Hi @Go release news @GPU deals under $400 ");
  await box.pressSequentially("anything new?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.waitForTimeout(300);
  const sent = requests.find(
    (r) => r.path.endsWith("/chat_tag/messages") && r.method === "POST",
  );
  assert(sent, "the tagged message was not sent");
  assert.equal(
    sent.body.content,
    "Hi @Go release news @GPU deals under $400 anything new?",
  );
  assert.deepEqual(sent.body.botTags, ["bot_gorelease", "bot_gpu"]);
  await expect(box).toHaveValue("");
  await expect(page.getByLabel("Tagged bots")).toHaveCount(0);
  // Dark theme.
  themeMode = "dark";
  await page.reload();
  await goAnswer.waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({
    path: "/tmp/timely-chat-tag-answer-dark.png",
    fullPage: true,
  });
  themeMode = "light";
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
        "/tmp/timely-chat-bot.png",
        "/tmp/timely-chat-bot-not-it.png",
        "/tmp/timely-chat-bot-two.png",
        "/tmp/timely-chat-bot-dark.png",
        "/tmp/timely-chat-bot-link.png",
        "/tmp/timely-chat-bot-brief.png",
        "/tmp/timely-chat-tag-answer.png",
        "/tmp/timely-chat-tag-picker.png",
        "/tmp/timely-chat-tag-full.png",
        "/tmp/timely-chat-tag-answer-dark.png",
      ],
    }),
  );
  await browser.close();
})();

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exit(1);
});
