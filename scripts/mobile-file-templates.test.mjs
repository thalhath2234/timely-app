import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import {
  docTemplateChoices,
  docTitleFromTemplate,
  oneLine,
  sheetTemplateChoices,
  suggestionKept,
  suggestionTitle,
  withSuggestion,
} from "../apps/mobile/lib/fileTemplates.ts";
import { cellFitEdit } from "../apps/mobile/lib/sheetCellFit.ts";
import { growGridTo } from "../apps/mobile/lib/sheetGrow.ts";

const builtins = [
  { id: "builtin:daily", title: "Daily note", icon: "📅" },
  { id: "builtin:meeting", title: "Meeting notes", icon: "🗓️" },
];

describe("docTemplateChoices", () => {
  test("describes built-ins in words and own templates by their text", () => {
    const own = { id: "doc_1", title: "Interview", icon: "📄" };
    const rows = docTemplateChoices([own, ...builtins], new Map([["doc_1", "Candidate\n  Questions\n\nVerdict"]]));
    assert.deepEqual(rows[0], { id: "doc_1", name: "Interview", icon: "📄", description: "Candidate Questions Verdict", mine: true });
    assert.equal(rows[1].mine, false);
    assert.equal(rows[2].description, "Agenda, notes, decisions and action items");
  });

  test("an own template with no text still says what it is", () => {
    assert.equal(docTemplateChoices([{ id: "doc_2", title: "", icon: "" }])[0].description, "Your template");
    assert.equal(docTemplateChoices([{ id: "doc_2", title: "", icon: "" }])[0].name, "Untitled");
  });
});

describe("sheetTemplateChoices", () => {
  const col = (name) => ({ id: name, name, type: "text", width: 100 });
  test("names the first columns and counts tabs", () => {
    const [row] = sheetTemplateChoices([
      { id: "t1", name: "Budget", icon: null, columns: ["Date", "Merchant", "Amount", "Category", "Notes"].map(col), tabs: [{}, {}] },
    ]);
    assert.equal(row.description, "Date, Merchant, Amount, Category +1 · 2 tabs");
    assert.equal(row.icon, undefined);
  });

  test("falls back to the first tab's columns, then a count", () => {
    assert.equal(sheetTemplateChoices([{ id: "t", name: "X", icon: "💰", columns: [], tabs: [{ columns: [col("Item")] }] }])[0].description, "Item");
    assert.equal(sheetTemplateChoices([{ id: "t", name: "X", icon: null, columns: [col(" ")], tabs: [] }])[0].description, "1 column");
  });
});

describe("withSuggestion", () => {
  const rows = docTemplateChoices(builtins);
  test("lifts the suggested template out of the list", () => {
    const { suggested, rest } = withSuggestion(rows, "builtin:meeting");
    assert.equal(suggested.id, "builtin:meeting");
    assert.deepEqual(rest.map((r) => r.id), ["builtin:daily"]);
  });

  test("ignores a template that is not offered", () => {
    const { suggested, rest } = withSuggestion(rows, "doc_gone");
    assert.equal(suggested, undefined);
    assert.equal(rest.length, 2);
  });
});

describe("suggestionTitle", () => {
  test("asks nothing for short or untitled names", () => {
    for (const title of ["", " ", "a", "Untitled", " untitled "]) assert.equal(suggestionTitle(title), "");
    assert.equal(suggestionTitle("  Standup  "), "Standup");
    assert.equal(suggestionTitle("年報"), "年報");
  });
});

describe("docTitleFromTemplate", () => {
  test("a typed name wins; else built-ins keep theirs and own templates say copy", () => {
    assert.equal(docTitleFromTemplate({ id: "builtin:meeting", title: "Meeting notes" }, " Standup "), "Standup");
    assert.equal(docTitleFromTemplate({ id: "builtin:meeting", title: "Meeting notes" }, ""), "Meeting notes");
    assert.equal(docTitleFromTemplate({ id: "doc_1", title: "Interview" }, ""), "Interview copy");
  });
});

describe("suggestionKept", () => {
  test("only answers when there was a suggestion", () => {
    assert.equal(suggestionKept(undefined, "t1"), undefined);
    assert.equal(suggestionKept("t1", "t1"), true);
    assert.equal(suggestionKept("t1", undefined), false);
    assert.equal(suggestionKept("t1", "t2"), false);
  });
});

test("oneLine clips long text", () => {
  assert.equal(oneLine("a ".repeat(50), 10), "a a a a a…");
});

describe("cellFitEdit on a brand-new row", () => {
  const category = { id: "c1", name: "Category", type: "text", width: 140 };
  const rows = [
    { id: "r1", cells: { c1: "Groceries" } },
    { id: "r2", cells: { c1: "Rent" } },
  ];
  let seq = 0;
  const makeRow = () => ({ id: `new${++seq}`, cells: { c1: "" } });

  test("an entry past the end is checked in the grown grid", () => {
    assert.equal(cellFitEdit(category, rows, 3, "Paris"), null);
    const grown = growGridTo({ columns: [category], rows }, { col: 0, row: 3 }, () => category, makeRow);
    const fit = cellFitEdit(category, grown.rows, 3, "Paris");
    assert.equal(fit.rowId, grown.rows[3].id);
    assert.deepEqual(fit.input, { column: "Category", type: "text", value: "Paris", values: ["Groceries", "Rent"], options: undefined });
  });

  test("a row added by Row below is checked like any other", () => {
    const added = [...rows, { id: "r3", cells: { c1: "" } }];
    assert.equal(cellFitEdit(category, added, 2, " Paris ").input.value, "Paris");
  });

  test("typed columns, formulas, blanks and unchanged entries are not asked", () => {
    assert.equal(cellFitEdit({ ...category, type: "currency" }, rows, 0, "Paris"), null);
    assert.equal(cellFitEdit(category, rows, 0, "=A2"), null);
    assert.equal(cellFitEdit(category, rows, 0, "  "), null);
    assert.equal(cellFitEdit(category, rows, 0, "Groceries"), null);
  });

  test("each check has a new id", () => {
    const a = cellFitEdit(category, rows, 0, "Paris");
    const b = cellFitEdit(category, rows, 0, "Paris");
    assert.notEqual(a.id, b.id);
  });
});

test("the API's built-in doc templates match the shared ones", () => {
  const contract = readFileSync(new URL("../packages/contract/src/templates.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../apps/api/internal/features/suggest/doc_template.go", import.meta.url), "utf8");
  const ids = (text) => [...text.matchAll(/"(builtin:[a-z]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(ids(api), ids(contract));
});
