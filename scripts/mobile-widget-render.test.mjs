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
const { renderCard, renderQuickAdd } = await import("../apps/mobile/lib/widgets/render.tsx");
const { cardWidgetModel, todayModel } = await import("../apps/mobile/lib/widgets/model.ts");
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
