#!/usr/bin/env node
// verify-timely browser driver: one command per call against the headless
// Chromium that `verify-timely.sh up` starts (CDP on 127.0.0.1:9339). Pages,
// cookies and sessionStorage persist between calls, so a journey is a sequence
// of shell commands. Usage: browser.mjs <command> [--flag value ...]; see SKILL.md.
import { createRequire } from "node:module";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(new URL(import.meta.url).pathname);
const srcRoot =
  process.env.VERIFY_TIMELY_SRC ||
  execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(resolve(srcRoot, "package.json"))("@playwright/test");

const BASE = process.env.VERIFY_TIMELY_WEB || "http://127.0.0.1:4002";
const CDP = `http://127.0.0.1:${process.env.VERIFY_TIMELY_CDP_PORT || 9339}`;
const EVIDENCE = process.env.VERIFY_TIMELY_EVIDENCE || "";

function parse(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { command, flags, positional };
}

function locate(page, f) {
  let scope = page;
  if (f["in-testid"]) scope = page.getByTestId(f["in-testid"]);
  if (f["in-role"]) scope = page.getByRole(f["in-role"], { name: f["in-name"], exact: Boolean(f.exact) });
  const exact = Boolean(f.exact);
  let loc;
  if (f.role) loc = scope.getByRole(f.role, f.name ? { name: f.name, exact } : {});
  else if (f.label) loc = scope.getByLabel(f.label, { exact });
  else if (f.placeholder) loc = scope.getByPlaceholder(f.placeholder, { exact });
  else if (f.text) loc = scope.getByText(f.text, { exact });
  else if (f.testid) loc = scope.getByTestId(f.testid);
  else if (f.css) loc = scope.locator(f.css);
  else return null;
  if (f.nth !== undefined) loc = loc.nth(Number(f.nth));
  else if (f.first) loc = loc.first();
  return loc;
}

function describe(f) {
  return ["role", "name", "label", "placeholder", "text", "testid", "css", "in-testid", "in-role", "in-name", "nth"]
    .filter((k) => f[k] !== undefined)
    .map((k) => `${k}=${JSON.stringify(f[k])}`)
    .join(" ");
}

function out(path, data) {
  const p = resolve(path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
}

function record(entry) {
  if (!EVIDENCE) return;
  mkdirSync(EVIDENCE, { recursive: true });
  appendFileSync(resolve(EVIDENCE, "actions.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

async function activePage(browser) {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const pages = context.pages().filter((p) => !p.url().startsWith("devtools://"));
  const page = pages.at(-1) ?? (await context.newPage());
  page.setDefaultTimeout(Number(process.env.VERIFY_TIMELY_TIMEOUT || 20000));
  return page;
}

async function apiCall(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const headers = { "Content-Type": "application/json" };
      const token = sessionStorage.getItem("timely.accessToken");
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(`/api-proxy${path}`, { method, headers, credentials: "include", body: body ?? undefined });
      const text = await r.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: r.status, body: json };
    },
    { method, path, body },
  );
}

async function run({ command, flags: f, positional }) {
  if (!command || command === "help") {
    console.log("commands: open, click, fill, press, wait, expect, text, snapshot, screenshot, url, api, signup-onboard");
    return;
  }
  const browser = await chromium.connectOverCDP(CDP).catch((e) => {
    throw new Error(`no verify browser on ${CDP} (run verify-timely.sh up): ${e.message}`);
  });
  try {
    const page = await activePage(browser);
    const loc = locate(page, f);
    const result = {};
    switch (command) {
      case "open": {
        const target = positional[0] || "/";
        const url = /^https?:/.test(target) ? target : `${BASE}${target.startsWith("/") ? "" : "/"}${target}`;
        if (!url.startsWith(BASE)) throw new Error(`refusing to open ${url}: only ${BASE} is the verify instance`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
        break;
      }
      case "click":
        if (!loc) throw new Error("click needs a locator (--role/--name, --label, --text, --testid, ...)");
        await loc.click();
        break;
      case "fill":
        if (!loc || f.value === undefined) throw new Error("fill needs a locator and --value");
        await loc.fill(String(f.value === true ? "" : f.value));
        break;
      case "press":
        if (loc) await loc.press(f.key);
        else await page.keyboard.press(f.key);
        break;
      case "wait":
        if (f["url-includes"]) await page.waitForURL((u) => u.toString().includes(f["url-includes"]), { timeout: Number(f.timeout || 60000) });
        else if (loc) await loc.waitFor({ state: f.state || "visible", timeout: Number(f.timeout || 30000) });
        else throw new Error("wait needs --url-includes or a locator");
        break;
      case "expect": {
        if (!loc) throw new Error("expect needs a locator");
        const n = await loc.count();
        if (f.count !== undefined && n !== Number(f.count)) throw new Error(`expected ${f.count} match(es) for ${describe(f)}, found ${n}`);
        if (f.absent) {
          if (n !== 0) throw new Error(`expected no match for ${describe(f)}, found ${n}`);
        } else {
          await loc.first().waitFor({ state: "visible", timeout: Number(f.timeout || 15000) });
        }
        result.count = n;
        break;
      }
      case "text":
        result.text = loc ? await loc.first().innerText() : await page.locator("body").innerText();
        break;
      case "snapshot": {
        const target = loc ?? page.locator("body");
        const yaml = await target.ariaSnapshot();
        if (f.path) result.saved = out(f.path, yaml);
        else result.aria = yaml;
        break;
      }
      case "screenshot":
        if (!f.path) throw new Error("screenshot needs --path");
        await (loc ?? page).screenshot({ path: out(f.path, ""), fullPage: Boolean(f.full) && !loc });
        result.saved = resolve(f.path);
        break;
      case "url":
        break;
      case "api": {
        const [method = "GET", path = "/me"] = positional;
        const r = await apiCall(page, method.toUpperCase(), path, f.body);
        result.status = r.status;
        result.body = r.body;
        if (f.path) result.saved = out(f.path, JSON.stringify(r, null, 2));
        break;
      }
      case "signup-onboard": {
        // Baseline account through the real UI: /signup -> onboarding -> tour -> app.
        const email = f.email || `verify+${Date.now()}@example.invalid`;
        const name = f.name || "Verify Bot";
        const password = f.password || "verify-pass-1234";
        const workspace = f.workspace || "Verify";
        await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.getByLabel("Name").fill(name);
        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Create account" }).click();
        await page.waitForURL(/\/onboarding/, { timeout: 60000 });
        await page.getByRole("button", { name: "Skip for now" }).click();
        await page.getByLabel("Workspace name").fill(workspace);
        await page.getByRole("button", { name: "Create workspace" }).click();
        const tour = page.getByRole("dialog", { name: "A short tour of Timely" });
        await tour.waitFor({ timeout: 60000 });
        await tour.getByRole("button", { name: "Skip" }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 60000 });
        Object.assign(result, { email, password, name, workspace });
        break;
      }
      default:
        throw new Error(`unknown command ${command}`);
    }
    result.url = page.url();
    result.title = await page.title().catch(() => "");
    record({ command, positional, locator: describe(f), flags: f, ok: true, result });
    console.log(JSON.stringify({ ok: true, command, ...result }, null, f.pretty ? 2 : 0));
  } finally {
    // Disconnect only; the browser and its pages stay up for the next command.
    await browser.close().catch(() => {});
  }
}

const args = parse(process.argv.slice(2));
run(args).catch((e) => {
  record({ command: args.command, positional: args.positional, locator: describe(args.flags), flags: args.flags, ok: false, error: e.message.split("\n")[0] });
  console.error(JSON.stringify({ ok: false, command: args.command, error: e.message.split("\n").slice(0, 6).join("\n") }));
  process.exit(1);
});
