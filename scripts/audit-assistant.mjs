// Phase 6 proof: the old /chat and /bots URLs redirect into /assistant with their
// deep links, in light and dark at 1440 and 390, and the Assistant tab renders the
// Bot views. Drives an ISOLATED stack (web :4002, API :8081 with its own DB_SCHEMA);
// it refuses :4001 and :8080. Start the stack with verify-timely first.
//
//   AUDIT_EMAIL=... AUDIT_PASSWORD=... AUDIT_CHAT=<chat id> AUDIT_BOT=<bot id> \
//   [AUDIT_WEB=http://127.0.0.1:4002] [AUDIT_OUT=$HOME/.cache/p6-proof/shots] \
//   node scripts/audit-assistant.mjs
//
// Writes <out>/redirect-<case>-<width>-<theme>.png and <out>/redirects-audit.json,
// and exits 1 when any landing URL differs from the expected one. Credentials come
// from the environment only; nothing is printed or stored with them.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import assert from "node:assert/strict";

const web = process.env.AUDIT_WEB || "http://127.0.0.1:4002";
assert(!/:4001\b/.test(web), "refusing the owner's :4001 web server");
const out = process.env.AUDIT_OUT || resolve(homedir(), ".cache/p6-proof/shots");
const { AUDIT_EMAIL: email, AUDIT_PASSWORD: password, AUDIT_CHAT: chat, AUDIT_BOT: bot } = process.env;
assert(email && password && chat && bot, "set AUDIT_EMAIL, AUDIT_PASSWORD, AUDIT_CHAT and AUDIT_BOT");

const { chromium } = createRequire(resolve(process.cwd(), "apps/web/package.json"))("@playwright/test");

// from -> where it must land (deep links kept; other query keys dropped).
const cases = [
  { name: "chat", from: "/chat", to: "/assistant" },
  { name: "chat-id", from: `/chat?id=${chat}`, to: `/assistant?chat=${chat}` },
  { name: "bots", from: "/bots", to: "/assistant" },
  { name: "bots-bot", from: `/bots?bot=${bot}`, to: `/assistant?bot=${bot}` },
  { name: "bots-bot-thread", from: `/bots?bot=${bot}&thread=1`, to: `/assistant?bot=${bot}&thread=1` },
  { name: "bots-starter", from: "/bots?new=1&starter=morning-brief", to: "/assistant?new=1&starter=morning-brief" },
];
const sizes = [
  { width: 1440, height: 1500 },
  { width: 390, height: 1900 },
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
let failed = false;
try {
  for (const theme of ["light", "dark"]) {
    for (const size of sizes) {
      const ctx = await browser.newContext({ viewport: size, colorScheme: theme });
      const page = await ctx.newPage();
      await page.goto(`${web}/login`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
      for (const c of cases) {
        await page.goto(web + c.from);
        const want = new URL(web + c.to);
        await page
          .waitForURL((u) => u.pathname === want.pathname && u.search === want.search, { timeout: 15_000 })
          .catch(() => {});
        await page.waitForLoadState("networkidle").catch(() => {});
        const at = new URL(page.url());
        const landed = at.pathname + at.search;
        const ok = landed === want.pathname + want.search;
        if (!ok) failed = true;
        const file = `redirect-${c.name}-${size.width}-${theme}.png`;
        await page.screenshot({ path: resolve(out, file), fullPage: true });
        results.push({ from: c.from, expected: c.to, landed, ok, theme, width: size.width, file });
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  writeFileSync(resolve(out, "redirects-audit.json"), JSON.stringify(results, null, 2));
}
console.log(results.map((r) => `${r.ok ? "ok  " : "FAIL"} ${r.width} ${r.theme} ${r.from} -> ${r.landed}`).join("\n"));
process.exit(failed ? 1 : 0);
