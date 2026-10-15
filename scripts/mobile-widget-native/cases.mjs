import { createRequire, register } from "node:module";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

// Every phone widget the app can draw: each Dashboard card (built-in, default,
// empty account), every timer state, sheet and doc card views, Today and Quick
// add, at the sizes a launcher gives them. Each one goes through the widget
// library's own tree builder and is written as JSON for WidgetDrawTest.java to
// draw natively. Usage: node scripts/mobile-widget-native/cases.mjs <out.json>
const root = new URL("../../", import.meta.url);
const mobile = new URL("apps/mobile/", root);
const require = createRequire(mobile);
const widgetLib = pathToFileURL(require.resolve("react-native-android-widget/package.json")).href.replace(/package\.json$/, "lib/module/");
const loader = `
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(mobile.href)});
const ts = require("typescript");
const lib = ${JSON.stringify(widgetLib)};
const stub = "data:text/javascript," + encodeURIComponent("export const AppRegistry={};export const NativeModules={};export const Platform={OS:'android'};export const TurboModuleRegistry={get:()=>null};export const Image={resolveAssetSource:(x)=>x};");
const widgets = "data:text/javascript," + encodeURIComponent(["FlexWidget","SvgWidget","TextWidget","ImageWidget","IconWidget","OverlapWidget","ListWidget"].map((n) => "export * from '" + lib + "widgets/" + n + ".js';").join(""));
export async function resolve(s, c, n) {
  if (s === "react-native") return { url: stub, shortCircuit: true };
  if (s === "react-native-android-widget") return { url: widgets, shortCircuit: true };
  if (s === "react" || s === "react/jsx-runtime") return { url: require("url").pathToFileURL(require.resolve(s)).href, shortCircuit: true };
  try { return await n(s, c); } catch (e) {
    if (s.startsWith("@timely/contract/")) return n(new URL("../../packages/contract/src/" + s.slice(17) + ".ts", ${JSON.stringify(mobile.href)}).href, c);
    if (s.startsWith(".")) for (const ext of [".ts", ".tsx", ".js"]) { try { return await n(s + ext, c); } catch {} }
    throw e;
  }
}
export async function load(url, c, n) {
  if (url.endsWith(".tsx")) {
    const source = await readFile(new URL(url), "utf8");
    const out = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } });
    return { format: "module", source: out.outputText, shortCircuit: true };
  }
  return n(url, c);
}`;
register("data:text/javascript," + encodeURIComponent(loader));

const { buildWidgetTree } = await import(widgetLib + "api/build-widget-tree.js");
const { renderCard, renderQuickAdd } = await import(new URL("lib/widgets/render.tsx", mobile).href);
const { cardWidgetModel, todayModel } = await import(new URL("lib/widgets/model.ts", mobile).href);
const { BUILTIN_CARDS, cardTitle, defaultDashboard } = await import(new URL("packages/contract/src/dashboard.ts", root).href);
const { buildYearlyExpenses } = await import(new URL("packages/contract/src/sheetTemplates.ts", root).href);

const now = new Date("2026-10-15T09:20:00Z");
const t0 = now.getTime();
const day = (n) => new Date(t0 - n * 86400000).toISOString();
const task = (id, name, extra = {}) => ({ id, name, priority: "medium", createdAt: day(5).slice(0, 10), ...extra });
const tasks = [
  task("a", "Send the Q3 invoice", { deadline: "2026-10-12", priority: "high" }),
  task("b", "Renew car insurance", { deadline: "2026-10-13" }),
  task("c", "Book dentist", { deadline: "2026-10-14", priority: "low" }),
  task("d", "Draft launch post", { completedAt: day(0) }),
  task("e", "Review pull request", { completedAt: day(0) }),
  task("f", "Water plants", { completedAt: day(1) }),
  task("g", "Plan sprint", { completedAt: day(2) }),
  task("h", "A very long task name that will need to be cut off somewhere sensible on a small widget", { deadline: "2026-10-16" }),
  task("i", "Call mum", { deadline: "2026-10-20" }),
];
const full = { tasks, inbox: [task("i1", "Idea: weekly digest", { inbox: true }), task("i2", "Receipt from cafe", { inbox: true })], projects: [{ id: "p1", name: "Launch", color: "#e5484d" }], workspaces: [], docs: [], sheets: [], reminders: [], events: [] };
const empty = { tasks: [], inbox: [], projects: [], workspaces: [], docs: [], sheets: [], reminders: [], events: [] };

const expPayload = buildYearlyExpenses({ year: 2026 });
const expenses = { id: "s1", ...expPayload, archivedAt: null };
const cols = [{ id: "m", name: "Month", width: 100, type: "text" }, { id: "v", name: "Spent", width: 100, type: "number" }, { id: "g", name: "Goal", width: 100, type: "number" }];
const mrows = [["Month", "Spent", "Goal"], ["Jul", "820", "1000"], ["Aug", "1240", "1000"], ["Sep", "640", "1000"], ["Oct", "910", "1000"], ["Total", "=SUM(B2:B5)", "4000"]].map((r, i) => ({ id: `r${i}`, cells: { m: r[0], v: r[1], g: r[2] } }));
const budget = { id: "s2", title: "Budget", columns: cols, rows: mrows, merges: [], tabs: [{ id: "tb", name: "Budget", columns: cols, rows: mrows, merges: [] }], archivedAt: null };
const water = { id: "s3", title: "Health log", columns: [{ id: "n", name: "Glasses", width: 80, type: "number" }], rows: [{ id: "r", cells: { n: "5" } }], merges: [], tabs: [{ id: "tw", name: "Log", columns: [{ id: "n", name: "Glasses", width: 80, type: "number" }], rows: [{ id: "r", cells: { n: "5" } }], merges: [] }], archivedAt: null };
const t = (text) => ({ type: "text", text });
const p = (text) => ({ type: "paragraph", content: [t(text)] });
const item = (text, checked) => ({ type: "taskItem", attrs: { checked }, content: [p(text)] });
const packing = { id: "d1", title: "Trip", content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [t("Kyoto trip")] }, p("Leave Friday 7am."), { type: "bulletList", content: [{ type: "listItem", content: [p("Hotel booked")] }] }, { type: "taskList", content: [item("Passport", true), item("Charger", false), item("Rain jacket", false), item("Train tickets", true)] }] } };
const emptyDoc = { id: "d2", title: "Empty", content: { type: "doc", content: [] } };
const files = { sheets: { s1: expenses, s2: budget, s3: water }, docs: { d1: packing, d2: emptyDoc } };

const todayFull = {
  items: [
    { kind: "event", eventId: "e1", title: "Standup", start: "2026-10-15T09:00:00Z", end: "2026-10-15T09:30:00Z", allDay: false, color: "#3987e5" },
    { kind: "task", taskId: "t1", title: "Write the v0.3.4 notes", start: "2026-10-15T10:00:00Z", end: "2026-10-15T11:30:00Z", allDay: false },
    { kind: "taskOccurrence", taskId: "t5", title: "Stretch", start: "2026-10-15T11:30:00Z", end: "2026-10-15T11:45:00Z", allDay: false, originalStart: "2026-10-15T11:30:00Z" },
    { kind: "event", eventId: "e2", title: "Lunch with Sam", start: "2026-10-15T12:30:00Z", end: "2026-10-15T13:30:00Z", allDay: false, color: "#1baf7a" },
    { kind: "task", taskId: "t2", title: "Review the widget PR", start: "2026-10-15T14:00:00Z", end: "2026-10-15T15:00:00Z", allDay: false },
  ],
  completedToday: [{ id: "d" }, { id: "e" }], todayFocus: [{ id: "t3" }], overdue: [{ id: "a" }],
  focusing: { id: "t9", name: "Polish widget layout" }, pausedFocus: null,
};
const todayEmpty = { items: [], completedToday: [], todayFocus: [], overdue: [], focusing: null, pausedFocus: null };

const base = { now, data: full, timeZone: "UTC", scheme: "timelymobile", today: todayFull, focusSessions: [{ taskId: "d", start: day(0), end: new Date(t0 - 3600e3).toISOString() }], pomodoros: [], files };
const emptyInput = { ...base, data: empty, today: todayEmpty, focusSessions: [], files: {} };

const SIZES = { "2x2": { width: 170, height: 170 }, "min": { width: 110, height: 110 }, "4x2": { width: 350, height: 170 }, "4x3": { width: 350, height: 250 }, "4x4": { width: 350, height: 350 }, "3x2": { width: 250, height: 170 }, "4x1": { width: 350, height: 110 }, "2x3": { width: 170, height: 250 } };
const cases = [];
const add = (group, name, model, sizes = Object.keys(SIZES)) => {
  for (const s of sizes) {
    const size = SIZES[s];
    const r = renderCard(model, size, { preview: true });
    cases.push({ group, name: `${name} · ${s}`, width: size.width, height: size.height, light: buildWidgetTree(r.light), dark: buildWidgetTree(r.dark) });
  }
};
const builtin = (type, settings, extra = {}) => ({ id: `w_${type}`, type, w: 3, h: 2, settings, ...extra });

for (const info of BUILTIN_CARDS) {
  const card = builtin(info.type, info.settings ? { ...info.settings } : undefined);
  add("Built-in cards", `${info.title || info.type}`, cardWidgetModel(card, base));
  add("Built-in cards, empty account", `${info.title || info.type} (empty)`, cardWidgetModel(card, emptyInput), ["2x2", "4x2"]);
}
for (const card of defaultDashboard().cards) {
  add("Your default Dashboard cards", cardTitle(card) || card.id, cardWidgetModel(card, base), ["2x2", "4x2", "4x4"]);
  add("Your default Dashboard cards, empty", `${cardTitle(card) || card.id} (empty)`, cardWidgetModel(card, emptyInput), ["2x2"]);
}
// Interactive states (running clocks drawn as text: on the phone a system Chronometer ticks in that spot)
const pomo = (state) => cardWidgetModel(builtin("pomodoro", { focus: 25, shortBreak: 5, longBreak: 15, rounds: 4 }, { id: "pp" }), { ...base, pomodoros: state ? [{ cardId: "pp", ...state }] : [] });
add("Timers", "Pomodoro ready", pomo(null));
add("Timers", "Pomodoro running with task", pomo({ phase: "focus", endsAt: t0 + 18 * 60000 + 42000, leftMs: 0, active: true, taskName: "Release notes" }));
add("Timers", "Pomodoro paused", pomo({ phase: "focus", endsAt: null, leftMs: 7 * 60000, active: true }));
add("Timers", "Pomodoro break", pomo({ phase: "short", endsAt: t0 + 3 * 60000, leftMs: 0, active: true }));
const clock = (settings) => cardWidgetModel(builtin("clock", settings, { id: "cc" }), base);
add("Timers", "Stopwatch idle", clock({ mode: "stopwatch", startedAt: null, elapsed: 0, laps: [] }));
add("Timers", "Stopwatch running with laps", clock({ mode: "stopwatch", startedAt: t0 - 95000, elapsed: 0, laps: [61000, 30000] }));
add("Timers", "Stopwatch paused", clock({ mode: "stopwatch", startedAt: null, elapsed: 754000, laps: [] }));
add("Timers", "Timer idle", clock({ mode: "timer", minutes: 10, startedAt: null, elapsed: 0 }));
add("Timers", "Timer running", clock({ mode: "timer", minutes: 10, startedAt: t0 - 120000, elapsed: 0 }));
add("Timers", "Timer done", clock({ mode: "timer", minutes: 10, startedAt: t0 - 700000, elapsed: 0 }));
add("Lists", "Habits", cardWidgetModel(builtin("habits", { habits: [{ id: "a", name: "Walk 30 min" }, { id: "b", name: "Read 20 pages" }, { id: "c", name: "No phone after 10" }], log: { "2026-10-15": ["a"], "2026-10-14": ["a", "b"] } }), base));
add("Lists", "Top 3", cardWidgetModel(builtin("topThree", { taskIds: ["a", "b", "d"] }), base));
add("Lists", "Countdown", cardWidgetModel(builtin("countdown", { label: "Launch", date: "2026-11-01" }), base));
add("Lists", "Countdown passed", cardWidgetModel(builtin("countdown", { label: "Launch", date: "2026-10-01" }), base));
add("Lists", "Scratchpad long note", cardWidgetModel(builtin("notes", { text: "Call the bank about the card.\nBuy milk, eggs and bread.\nAsk Sam about Friday.\n".repeat(4) }), base));
add("Today widget", "Today busy", todayModel(base));
add("Today widget", "Today empty day", todayModel({ ...base, today: todayEmpty }));
add("Today widget", "Today not loaded", todayModel({ ...base, today: null }));
add("Today widget", "Signed out", { title: "Today", uri: "timelymobile://", empty: "Open Timely and sign in to see this." }, ["2x2", "4x2"]);

const customBase = defaultDashboard().cards.find((c) => c.id === "default_open");
const custom = (title, query) => ({ ...customBase, id: "cu", title, query: { ...customBase.query, ...query } });
const sheetViews = ["table", "value", "bar", "line", "pie", "progress", "counter", "addRow"];
for (const view of sheetViews) {
  add("Sheet cards (Expenses 2026)", `Summary ${view}`, cardWidgetModel(custom(`${view} · Expenses 2026`, { sheet: { sheetId: "s1", tabId: expenses.tabs[0].id, range: "A1:D14", view, headers: true } }), base), ["2x2", "4x2", "4x4"]);
  add("Sheet cards (Budget)", `Budget ${view}`, cardWidgetModel(custom(`Budget ${view}`, { sheet: { sheetId: "s2", tabId: "tb", range: view === "value" || view === "counter" || view === "progress" ? "B6" : "A1:C5", target: view === "progress" ? "C6" : undefined, view, headers: view !== "value" && view !== "counter" && view !== "progress", step: 1 } }), base), ["2x2", "4x2"]);
}
add("Sheet cards (Budget)", "Counter on a number cell", cardWidgetModel(custom("Water today", { sheet: { sheetId: "s3", tabId: "tw", range: "A1", view: "counter", step: 1 } }), base), ["min", "2x2", "4x2"]);
add("Sheet cards (Budget)", "Sheet deleted", cardWidgetModel(custom("Gone", { sheet: { sheetId: "zz", range: "A1", view: "value" } }), base), ["2x2"]);
for (const view of ["checklist", "page"]) {
  add("Doc cards", `Trip ${view}`, cardWidgetModel(custom(`Trip ${view}`, { doc: { docId: "d1", view } }), base), ["2x2", "4x2", "4x4"]);
  add("Doc cards", `Empty doc ${view}`, cardWidgetModel(custom(`Empty ${view}`, { doc: { docId: "d2", view } }), base), ["2x2"]);
}
const qa = [
  { label: "Task", glyph: "task", uri: "timelymobile://shortcut/new-task" }, { label: "Capture", glyph: "capture", uri: "timelymobile://shortcut/capture" },
  { label: "Ask", glyph: "ask", uri: "timelymobile://shortcut/ask" }, { label: "Search", glyph: "search", uri: "timelymobile://shortcut/search" }];
for (const size of [{ width: 250, height: 56 }, { width: 350, height: 64 }, { width: 350, height: 90 }, { width: 420, height: 72 }]) {
  const r = renderQuickAdd(qa, size);
  cases.push({ group: "Quick add", name: `Quick add · ${size.width}x${size.height}`, width: size.width, height: size.height, light: buildWidgetTree(r.light), dark: buildWidgetTree(r.dark) });
}
writeFileSync(process.argv[2] ?? "widget-cases.json", JSON.stringify(cases));
console.log(cases.length, "cases");
