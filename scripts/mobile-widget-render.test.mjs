import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import test, { describe } from "node:test";

// Draws every widget through the widget library's own tree builder (what the
// phone runs before drawing), so a tree it can't take fails here instead of
// as a blank widget. TSX is compiled with the app's TypeScript and
// react-native is stubbed; nothing here needs a phone.
const mobile = new URL("../apps/mobile/", import.meta.url);
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
const { planCard, renderCard, renderQuickAdd } = await import("../apps/mobile/lib/widgets/render.tsx");
const { cardWidgetModel, clockWidgetModel, counterWidgetModel, pomodoroLocalFrom, pomodoroWidgetModel, sheetCounter, todayModel } = await import("../apps/mobile/lib/widgets/model.ts");
const { BUILTIN_CARDS, defaultDashboard } = await import("../packages/contract/src/dashboard.ts");
const { buildYearlyExpenses } = await import("../packages/contract/src/sheetTemplates.ts");

const SIZES = [
  { width: 110, height: 110 },
  { width: 170, height: 170 },
  { width: 320, height: 160 },
  { width: 320, height: 320 },
];

/** Builds both themes the way the phone does and checks every text and size is drawable. */
function draw(rendered, label) {
  for (const [theme, element] of Object.entries(rendered)) {
    let tree;
    assert.doesNotThrow(() => (tree = buildWidgetTree(element)), `${label} (${theme})`);
    const walk = (node, path) => {
      for (const [key, value] of Object.entries(node.props ?? {})) {
        if (typeof value === "number") assert.ok(Number.isFinite(value), `${path}.${key} is ${value}`);
        // Android reads a weight as a whole number, so 0.4 would draw as 0.
        if (key === "weight") assert.ok(Number.isInteger(value) && value > 0, `${path}.weight is ${value}`);
      }
      if (node.type === "TextWidget") assert.equal(typeof node.props.text, "string", `${path} text`);
      (node.children ?? []).forEach((child, index) => walk(child, `${path}/${node.type}[${index}]`));
    };
    walk(tree, `${label} ${theme}`);
  }
}

const now = new Date("2026-10-15T09:00:00Z");
const task = (id, extra = {}) => ({ id, name: `Task ${id}`, priority: "medium", createdAt: "2026-10-10T00:00:00Z", ...extra });
const payload = buildYearlyExpenses({ year: 2026 });
const sheet = { id: "s1", ...payload, archivedAt: null };
const t = (text) => ({ type: "text", text });
const item = (text, checked) => ({ type: "taskItem", attrs: { checked }, content: [{ type: "paragraph", content: [t(text)] }] });
const doc = { id: "d1", content: { type: "doc", content: [{ type: "heading", content: [t("Trip")] }, { type: "taskList", content: [item("Passport", true), item("Jacket", false)] }] } };
const input = {
  now,
  data: { tasks: [task("a", { deadline: "2026-10-10" }), task("b", { completedAt: "2026-10-15T08:00:00Z" }), task("d")], inbox: [task("i1", { inbox: true })], projects: [], workspaces: [], docs: [], sheets: [sheet], reminders: [], events: [] },
  timeZone: "UTC",
  scheme: "timelymobile",
  today: null,
  focusSessions: [],
  pomodoros: [],
  files: { sheets: { s1: sheet }, docs: { d1: doc } },
};

describe("widgets draw on the phone", () => {
  test("every built-in card at every size", () => {
    for (const info of BUILTIN_CARDS) {
      const card = { id: `w_${info.type}`, type: info.type, w: info.w, h: info.h, settings: info.settings ? { ...info.settings } : undefined };
      const model = cardWidgetModel(card, input);
      for (const size of SIZES) draw(renderCard(model, size), `${info.type} ${size.width}x${size.height}`);
    }
  });

  test("every card on the default board, and Today", () => {
    for (const card of defaultDashboard().cards) {
      const model = cardWidgetModel(card, input);
      for (const size of SIZES) draw(renderCard(model, size), `${card.id} ${size.width}x${size.height}`);
    }
    for (const size of SIZES) draw(renderCard(todayModel(input), size), `today ${size.width}x${size.height}`);
  });

  test("sheet cards from Expenses 2026 in every view, and doc cards", () => {
    const base = defaultDashboard().cards.find((c) => c.id === "default_open");
    for (const tab of sheet.tabs.slice(0, 3)) {
      for (const range of ["A1:D8", "A2:B13", "B2"]) {
        for (const view of ["table", "value", "bar", "line", "pie", "progress", "counter", "addRow"]) {
          const card = { ...base, query: { ...base.query, sheet: { sheetId: "s1", tabId: tab.id, range, view, headers: true } } };
          const model = cardWidgetModel(card, input);
          for (const size of SIZES) draw(renderCard(model, size), `${tab.name} ${range} ${view} ${size.width}x${size.height}`);
        }
      }
    }
    for (const view of ["checklist", "page"]) {
      const model = cardWidgetModel({ ...base, query: { ...base.query, doc: { docId: "d1", view } } }, input);
      for (const size of SIZES) draw(renderCard(model, size), `doc ${view}`);
    }
  });

  test("the Pomodoro and Timer widgets, and the trees the phone redraws them from", () => {
    const texts = (tree, out = []) => {
      if (tree.type === "TextWidget") out.push(tree.props.text);
      for (const child of tree.children ?? []) texts(child, out);
      return out;
    };
    const local = { ...pomodoroLocalFrom(undefined), phase: "long" };
    const pomodoro = pomodoroWidgetModel({ cardId: "widget-1", title: "Pomodoro", uri: "timelymobile://", settings: undefined, now: now.getTime(), pomodoros: [], local });
    const timer = clockWidgetModel({ cardId: "widget-2", title: "Timer", uri: "timelymobile://", state: { mode: "stopwatch", minutes: 10, startedAt: null, elapsed: 0, laps: [], done: false }, now: now.getTime(), local: { mode: "timer", minutes: 45 } });
    for (const [model, value, token] of [[pomodoro, "15:00", "{{long:clock}}"], [timer, "45:00", "{{minutes:clock}}"]]) {
      for (const size of SIZES) {
        draw(renderCard(model, size), `${model.title} ${size.width}x${size.height}`);
        draw(renderCard(model, size, { local: true }), `${model.title} local ${size.width}x${size.height}`);
      }
      // The app draws the real time; the phone's copy has the token it fills in.
      const size = SIZES[2];
      assert.ok(texts(buildWidgetTree(renderCard(model, size).light)).includes(value));
      const phone = texts(buildWidgetTree(renderCard(model, size, { local: true }).light));
      assert.ok(phone.includes(token) && !phone.includes(value), model.title);
    }
  });

  test("a sheet counter's two drawings: −/+ change it on the phone, Save goes to the app", () => {
    const columns = [{ id: "n", name: "Spent", width: 100, type: "currency", format: { currency: "USD" } }];
    const rows = [{ id: "r1", cells: { n: "1250" } }];
    const water = { id: "s9", title: "Budget", columns, rows, merges: [], tabs: [{ id: "tb", name: "Budget", columns, rows, merges: [] }], archivedAt: null };
    const counter = sheetCounter({ sheetId: "s9", tabId: "tb", range: "A1", view: "counter", step: 5 }, { ...input, files: { sheets: { s9: water } } }, "Spent", "cnt");
    const clicks = (tree, out = []) => {
      if (tree.props?.clickAction) out.push(tree.props.clickAction);
      for (const child of tree.children ?? []) clicks(child, out);
      return out;
    };
    const texts = (tree, out = []) => {
      if (tree.type === "TextWidget") out.push(tree.props.text);
      for (const child of tree.children ?? []) texts(child, out);
      return out;
    };
    for (const changed of [false, true]) {
      const model = counterWidgetModel({ ...counter.widget, local: { count: 1260, base: 1250 } }, changed);
      for (const size of SIZES) {
        draw(renderCard(model, size), `counter ${changed} ${size.width}x${size.height}`);
        draw(renderCard(model, size, { local: true }), `counter local ${changed} ${size.width}x${size.height}`);
      }
      const phone = buildWidgetTree(renderCard(model, SIZES[1], { local: true }).light);
      assert.deepEqual(clicks(phone).filter((click) => click !== "OPEN_URI"), changed ? ["TIMELY_LOCAL", "TIMELY_ACTION", "TIMELY_LOCAL"] : ["TIMELY_LOCAL", "TIMELY_LOCAL"]);
      assert.ok(texts(phone).includes("{{count:'$'#,##0.00;-'$'#,##0.00}}"));
      assert.ok(texts(buildWidgetTree(renderCard(model, SIZES[1]).light)).includes(changed ? "$1,260.00" : "$1,250.00"));
    }
  });

  test("a described card with a chart and a list keeps both on a big widget", () => {
    const base = defaultDashboard().cards.find((c) => c.id === "default_open");
    const program = `root = Panel("Work", [nums, chart, list])
todo = @Data({source: "tasks", state: "all", limit: 5})
nums = Stats([Stat("Tasks", todo.text)])
chart = BarChart("By day", ["Mon", "Tue", "Wed"], [2, 5, 1])
list = List(@Each(todo.rows, "t", TaskRow(t.id, t.title, t.day, t.note)), "Nothing")`;
    const model = cardWidgetModel({ ...base, id: "dc", query: { ...base.query, described: { prompt: "work", program } } }, input);
    for (const size of SIZES) draw(renderCard(model, size), `described ${size.width}x${size.height}`);
    for (const size of [{ width: 320, height: 320 }, { width: 320, height: 480 }]) {
      const plan = planCard(model, size);
      assert.ok(plan.bars > 0, `${size.height}: chart`);
      assert.ok(plan.rows >= 2, `${size.height}: rows with their ticks`);
    }
    // A chart with no rows still takes all the room it had.
    const { rows, ...chartOnly } = model;
    assert.equal(planCard(chartOnly, { width: 320, height: 320 }).bars, 140);
    // On a 4x2 the chart gives up rows before it gives up itself.
    const noStats = cardWidgetModel({ ...base, id: "dc2", query: { ...base.query, described: { prompt: "work", program: program.replace("[nums, chart, list]", "[chart, list]") } } }, input);
    const short = planCard(noStats, { width: 320, height: 160 });
    assert.ok(short.bars > 0 && short.rows >= 1, JSON.stringify(short));
    // A note under a chart (a Text, or a doc the card can't find) draws at every size but the smallest.
    const noted = cardWidgetModel({ ...base, id: "dc3", query: { ...base.query, described: { prompt: "notes", program: `root = Panel("Done", [Columns([Card("Overdue", [Stats([Stat("Overdue", "4")])]), Card("Per day", [BarChart("Per day", ["Mon", "Tue"], [1, 3]), Text("Keep going")])])])` } } }, input);
    for (const size of SIZES) draw(renderCard(noted, size), `noted ${size.width}x${size.height}`);
    for (const size of SIZES.slice(1)) assert.ok(planCard(noted, size).noteLines >= 1, `note at ${size.width}x${size.height}`);
    assert.ok(planCard(noted, { width: 320, height: 320 }).bars > 0);
    // A short wide widget keeps its chart beside the figure and the note under them.
    for (const height of [110, 140]) {
      const plan = planCard(noted, { width: 320, height });
      assert.equal(plan.mode, "wide", `${height}`);
      assert.ok(plan.bars > 0 && plan.noteLines >= 1, `${height}: ${JSON.stringify(plan)}`);
      draw(renderCard(noted, { width: 320, height }), `noted 320x${height}`);
    }
  });

  test("the card picker's still preview", () => {
    const card = defaultDashboard().cards[0];
    draw({ light: renderCard(cardWidgetModel(card, input), SIZES[1], { preview: true }).light }, "preview");
  });

  test("Quick add at its sizes", () => {
    const buttons = [
      { label: "Task", glyph: "plus", uri: "timelymobile://shortcut/new-task" },
      { label: "Capture", glyph: "inbox", uri: "timelymobile://shortcut/capture" },
      { label: "Ask", glyph: "sparkle", uri: "timelymobile://shortcut/ask" },
      { label: "Search", glyph: "search", uri: "timelymobile://shortcut/search" },
    ];
    for (const size of [{ width: 250, height: 40 }, { width: 320, height: 60 }, { width: 320, height: 110 }]) draw(renderQuickAdd(buttons, size), `quick add ${size.width}x${size.height}`);
  });
});
