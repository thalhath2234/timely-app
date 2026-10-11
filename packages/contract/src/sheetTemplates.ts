import type { CreateSheetPayload, SheetCellFormat, SheetRow, SheetTab } from "./sheet";
import type { SheetColumn, SheetColumnFormat, SheetConditionalFormat } from "./sheetTypes";

/**
 * Sheets that ship with Timely. They are built on the device and created as
 * an ordinary sheet, so people can change anything afterwards.
 */

export interface BuiltinSheetTemplate {
  /** "builtin:<name>", never a stored template id. */
  id: string;
  name: string;
  icon: string;
  description: string;
  build: (options?: { year?: number; currency?: string }) => CreateSheetPayload;
}

export function isBuiltinSheetTemplate(id: string | undefined) {
  return Boolean(id?.startsWith("builtin:"));
}

let idCounter = 0;
function makeId(prefix: string) {
  idCounter += 1;
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const EXPENSE_CATEGORIES = [
  "Groceries",
  "Dining out",
  "Transport",
  "Fuel",
  "Rent",
  "Bills & utilities",
  "Phone & internet",
  "Health",
  "Shopping",
  "Home",
  "Personal care",
  "Education",
  "Entertainment",
  "Subscriptions",
  "Travel",
  "Gifts",
  "Other",
];

export const EXPENSE_UNITS = [
  "pcs",
  "kg",
  "g",
  "L",
  "ml",
  "pack",
  "box",
  "bottle",
  "dozen",
  "pair",
  "hour",
  "day",
  "month",
  "trip",
];

export const EXPENSE_PAYMENTS = ["Cash", "Card", "Bank transfer", "Mobile wallet", "Credit"];

const TOTAL_FILL = "#1F2A24";
const WARN_FILL = "#5C3A12";
const OVER_FILL = "#5F2120";
const WARN_TEXT = "#FCD9A8";
const OVER_TEXT = "#FFD7D3";
const GOOD_TEXT = "#81C995";
const BAD_TEXT = "#F28B82";
/** Zero months and categories fade back so the ones with spending stand out. */
const ZERO_TEXT = "#5E6472";

function fadeZeros(columns: SheetColumn[]): SheetConditionalFormat[] {
  return columns.map((column) => ({ id: makeId("cf"), columnId: column.id, operator: "eq", value: "0", textColor: ZERO_TEXT }));
}

let activeCurrency = "";
/** A currency column's format; no symbol when the person has not picked one. */
function money(extra: SheetColumnFormat = {}): SheetColumnFormat | undefined {
  const format = { ...(activeCurrency ? { currency: activeCurrency } : {}), ...extra };
  return Object.keys(format).length ? format : undefined;
}

function row(cells: Record<string, string>, formats?: Record<string, SheetCellFormat>): SheetRow {
  return { id: makeId("row"), cells, ...(formats ? { formats } : {}) };
}

function boldAll(columns: SheetColumn[], fill: string, extra: Partial<SheetCellFormat> = {}) {
  return Object.fromEntries(columns.map((column) => [column.id, { bold: true, fillColor: fill, ...extra }]));
}

function monthTab(name: string): SheetTab {
  const col = (_key: string, column: Omit<SheetColumn, "id">): SheetColumn => ({ id: makeId("col"), ...column });
  const date = col("date", { name: "Date", width: 112, type: "date", format: { dateFormat: "ddd d mmm" } });
  const item = col("item", { name: "Item", width: 200, type: "text" });
  const category = col("category", { name: "Category", width: 150, type: "select", options: EXPENSE_CATEGORIES });
  const store = col("store", { name: "Store / from", width: 150, type: "text" });
  const qty = col("qty", { name: "Qty", width: 76, type: "number" });
  const unit = col("unit", { name: "Unit", width: 92, type: "select", options: EXPENSE_UNITS });
  const price = col("price", { name: "Unit price", width: 116, type: "currency", format: money() });
  const total = col("total", { name: "Total", width: 124, type: "currency", format: money() });
  const payment = col("payment", { name: "Paid with", width: 124, type: "select", options: EXPENSE_PAYMENTS });
  const notes = col("notes", { name: "Notes", width: 220, type: "text" });
  const columns = [date, item, category, store, qty, unit, price, total, payment, notes];
  const letter = (column: SheetColumn) => String.fromCharCode(65 + columns.indexOf(column));

  const L = {
    item: letter(item),
    qty: letter(qty),
    price: letter(price),
    total: letter(total),
  };

  const totals = row(
    {
      [date.id]: "",
      [item.id]: `="Month total · "&COUNTA(${L.item}2:${L.item})&IF(COUNTA(${L.item}2:${L.item})=1," item"," items")`,
      [category.id]: "",
      [store.id]: "",
      [qty.id]: "",
      [unit.id]: "",
      [price.id]: "",
      [total.id]: `=SUM(${L.total}2:${L.total})`,
      [payment.id]: "",
      [notes.id]: "",
    },
    boldAll(columns, TOTAL_FILL),
  );

  const entries: SheetRow[] = [];
  for (let index = 0; index < 60; index += 1) {
    const r = index + 2;
    const cells: Record<string, string> = Object.fromEntries(columns.map((column) => [column.id, ""]));
    // Qty is optional: a blank Qty counts as one.
    cells[total.id] = `=IF(${L.price}${r}="","",IF(${L.qty}${r}="",1,${L.qty}${r})*${L.price}${r})`;
    entries.push(row(cells));
  }

  const conditionalFormats: SheetConditionalFormat[] = [
    {
      id: makeId("cf"),
      columnId: total.id,
      operator: "aboveAverage",
      fillColor: WARN_FILL,
      textColor: WARN_TEXT,
    },
  ];

  return {
    id: makeId("tab"),
    name,
    columns,
    rows: [totals, ...entries],
    merges: [],
    frozenRows: 1,
    frozenCols: 2,
    conditionalFormats,
  };
}

function quote(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

function summaryTab(): SheetTab {
  const columns: SheetColumn[] = [
    { id: makeId("col"), name: "Month", width: 130, type: "text" },
    { id: makeId("col"), name: "Spent", width: 130, type: "currency", format: money() },
    { id: makeId("col"), name: "Budget", width: 130, type: "currency", format: money() },
    { id: makeId("col"), name: "Left", width: 130, type: "currency", format: money() },
    { id: makeId("col"), name: "Used", width: 90, type: "percent", format: { decimals: 0 } },
    { id: makeId("col"), name: "Items", width: 96, type: "number" },
    { id: makeId("col"), name: "Biggest buy", width: 130, type: "currency", format: money() },
    { id: makeId("col"), name: "Notes", width: 220, type: "text" },
  ];
  const [month, spent, budget, left, used, items, biggest, notes] = columns;
  const rows: SheetRow[] = MONTH_NAMES.map((name, index) => {
    const r = index + 1;
    const tab = quote(name);
    return row({
      [month.id]: name,
      [spent.id]: `=SUM(${tab}!H2:H)`,
      [budget.id]: "",
      [left.id]: `=IF(C${r}="","",C${r}-B${r})`,
      [used.id]: `=IF(OR(C${r}="",C${r}=0),"",B${r}/C${r})`,
      [items.id]: `=COUNTA(${tab}!B2:B)`,
      [biggest.id]: `=MAX(${tab}!H2:H)`,
      [notes.id]: "",
    });
  });
  const totalFormats = boldAll(columns, TOTAL_FILL);
  rows.push(
    row(
      {
        [month.id]: "Year total",
        [spent.id]: "=SUM(B1:B12)",
        [budget.id]: '=IF(COUNT(C1:C12)=0,"",SUM(C1:C12))',
        [left.id]: '=IF(C13="","",C13-B13)',
        [used.id]: '=IF(OR(C13="",C13=0),"",B13/C13)',
        [items.id]: "=SUM(F1:F12)",
        [biggest.id]: "=MAX(G1:G12)",
        [notes.id]: "",
      },
      totalFormats,
    ),
    row(
      {
        [month.id]: "Monthly average",
        [spent.id]: '=IF(COUNTIF(B1:B12,">0")=0,0,SUMIF(B1:B12,">0")/COUNTIF(B1:B12,">0"))',
        [budget.id]: '=IF(COUNT(C1:C12)=0,"",AVERAGE(C1:C12))',
        [left.id]: "",
        [used.id]: "",
        [items.id]: '=IF(COUNTIF(F1:F12,">0")=0,0,ROUND(SUMIF(F1:F12,">0")/COUNTIF(F1:F12,">0"),0))',
        [biggest.id]: "",
        [notes.id]: "Months with spending only",
      },
      Object.fromEntries(columns.map((column) => [column.id, { italic: true }])),
    ),
  );
  return {
    id: makeId("tab"),
    name: "Summary",
    color: "#6E56CF",
    columns,
    rows,
    merges: [],
    frozenRows: 0,
    frozenCols: 1,
    conditionalFormats: [
      { id: makeId("cf"), columnId: used.id, operator: "gt", value: "1", fillColor: OVER_FILL, textColor: OVER_TEXT, wholeRow: false },
      { id: makeId("cf"), columnId: left.id, operator: "lt", value: "0", textColor: BAD_TEXT, bold: true },
      { id: makeId("cf"), columnId: left.id, operator: "gte", value: "0", textColor: GOOD_TEXT },
      ...fadeZeros([spent, items, biggest]),
    ],
  };
}

function categoriesTab(): SheetTab {
  const category: SheetColumn = { id: makeId("col"), name: "Category", width: 150, type: "text" };
  const monthColumns: SheetColumn[] = MONTH_NAMES.map((name) => ({
    id: makeId("col"),
    name: name.slice(0, 3),
    width: 96,
    type: "currency",
    format: money({ decimals: 0 }),
  }));
  const year: SheetColumn = { id: makeId("col"), name: "Year", width: 116, type: "currency", format: money({ decimals: 0 }) };
  const share: SheetColumn = { id: makeId("col"), name: "Share", width: 80, type: "percent", format: { decimals: 0 } };
  const columns = [category, ...monthColumns, year, share];
  const lastMonth = String.fromCharCode(65 + monthColumns.length); // M
  const yearLetter = String.fromCharCode(65 + monthColumns.length + 1); // N
  const totalRow = EXPENSE_CATEGORIES.length + 1;

  const otherRow = EXPENSE_CATEGORIES.length;
  const rows: SheetRow[] = EXPENSE_CATEGORIES.map((name, index) => {
    const r = index + 1;
    const last = r === otherRow;
    // "Other" also takes entries with no category or one typed outside the
    // list, so the categories always add up to the month's spending.
    const cells: Record<string, string> = { [category.id]: last ? "Other or none" : name };
    MONTH_NAMES.forEach((month, m) => {
      const tab = quote(month);
      const letter = String.fromCharCode(66 + m);
      cells[monthColumns[m].id] = last
        ? `=ROUND(SUM(${tab}!H2:H)-SUM(${letter}1:${letter}${otherRow - 1}),2)`
        : `=SUMIF(${tab}!C2:C,$A${r},${tab}!H2:H)`;
    });
    cells[year.id] = `=SUM(B${r}:${lastMonth}${r})`;
    cells[share.id] = `=IF($${yearLetter}$${totalRow}=0,"",${yearLetter}${r}/$${yearLetter}$${totalRow})`;
    return row(cells);
  });
  const totals: Record<string, string> = { [category.id]: "Total" };
  columns.slice(1, -1).forEach((column, index) => {
    const letter = String.fromCharCode(66 + index);
    totals[column.id] = `=SUM(${letter}1:${letter}${EXPENSE_CATEGORIES.length})`;
  });
  totals[share.id] = "";
  rows.push(row(totals, boldAll(columns, TOTAL_FILL)));

  return {
    id: makeId("tab"),
    name: "Categories",
    color: "#12A594",
    columns,
    rows,
    merges: [],
    frozenRows: 0,
    frozenCols: 1,
    conditionalFormats: [
      { id: makeId("cf"), columnId: year.id, operator: "aboveAverage", fillColor: WARN_FILL, textColor: WARN_TEXT },
      ...fadeZeros([...monthColumns, year]),
    ],
  };
}

/** Summary, a category breakdown and one tab per month with what was bought, where, how much and how it was paid. */
export function buildYearlyExpenses(options: { year?: number; currency?: string } = {}): CreateSheetPayload {
  const year = options.year ?? new Date().getFullYear();
  activeCurrency = options.currency?.trim() ?? "";
  const tabs = [summaryTab(), categoriesTab(), ...MONTH_NAMES.map((name) => monthTab(name))];
  const first = tabs[0];
  return {
    title: `Expenses ${year}`,
    icon: "💸",
    columns: first.columns,
    rows: first.rows,
    merges: [],
    tabs,
  };
}

export const BUILTIN_SHEET_TEMPLATES: BuiltinSheetTemplate[] = [
  {
    id: "builtin:yearly-expenses",
    name: "Yearly expenses",
    icon: "💸",
    description: "A tab for every month, a summary with budgets, and spending by category",
    build: buildYearlyExpenses,
  },
];

export function builtinSheetTemplate(id: string) {
  return BUILTIN_SHEET_TEMPLATES.find((template) => template.id === id);
}
