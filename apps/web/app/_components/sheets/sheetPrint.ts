import type { SheetCellFormat, SheetColumn, SheetMerge, SheetRow } from "@/app/_types/types";
import type { ConditionalStyle } from "@timely/contract/sheetDisplay";
import { defaultAlign } from "@/app/utils/sheetDisplay";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === '"' ? "&quot;" : "&#39;",
  );
}

/**
 * A printable page built from the sheet's data (not the on-screen grid, which
 * only holds the rows in view): a light table with the visible columns and
 * rows, cell formats, merges and colour rules.
 */
export function sheetPrintHtml(options: {
  title: string;
  columns: SheetColumn[];
  visibleCols: number[];
  rows: SheetRow[];
  visibleRows: number[];
  merges: SheetMerge[];
  displayAt: (col: number, row: number) => string;
  conditional: Map<string, ConditionalStyle>;
}): string {
  const { columns, visibleCols, rows, visibleRows, merges, displayAt, conditional } = options;
  const covered = new Set<string>();
  const spans = new Map<string, { colSpan: number; rowSpan: number }>();
  const visibleColSet = new Set(visibleCols);
  const visibleRowSet = new Set(visibleRows);
  for (const merge of merges) {
    let colSpan = 0;
    for (let col = merge.startCol; col < merge.startCol + merge.colSpan; col += 1) if (visibleColSet.has(col)) colSpan += 1;
    let rowSpan = 0;
    for (let row = merge.startRow; row < merge.startRow + merge.rowSpan; row += 1) if (visibleRowSet.has(row)) rowSpan += 1;
    spans.set(`${merge.startCol}:${merge.startRow}`, { colSpan: Math.max(1, colSpan), rowSpan: Math.max(1, rowSpan) });
    for (let row = merge.startRow; row < merge.startRow + merge.rowSpan; row += 1) {
      for (let col = merge.startCol; col < merge.startCol + merge.colSpan; col += 1) {
        if (row !== merge.startRow || col !== merge.startCol) covered.add(`${col}:${row}`);
      }
    }
  }

  const header = visibleCols
    .map((col) => `<th style="width:${columns[col].width}px">${escapeHtml(columns[col].name)}</th>`)
    .join("");
  const body = visibleRows
    .map((rowIndex) => {
      const row = rows[rowIndex];
      const cells = visibleCols
        .map((col) => {
          const key = `${col}:${rowIndex}`;
          if (covered.has(key)) return "";
          const column = columns[col];
          const format: SheetCellFormat = { ...(row.formats?.[column.id] ?? {}), ...(conditional.get(key) ?? {}) };
          const span = spans.get(key);
          const style = [
            `text-align:${format.align ?? defaultAlign(column.type)}`,
            format.bold ? "font-weight:700" : "",
            format.italic ? "font-style:italic" : "",
            format.underline || format.strikethrough
              ? `text-decoration:${[format.underline ? "underline" : "", format.strikethrough ? "line-through" : ""].join(" ").trim()}`
              : "",
            format.fillColor ? `background:${format.fillColor};color:#fff` : "",
            format.wrap ? "white-space:pre-wrap" : "white-space:nowrap",
            format.fontSize ? `font-size:${format.fontSize}px` : "",
          ]
            .filter(Boolean)
            .join(";");
          const attributes = span ? ` colspan="${span.colSpan}" rowspan="${span.rowSpan}"` : "";
          return `<td${attributes} style="${style}">${escapeHtml(displayAt(col, rowIndex))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(options.title)}</title><style>
    body{font:11px system-ui,sans-serif;color:#111;margin:16px}
    h1{font-size:14px;margin:0 0 8px}
    table{border-collapse:collapse;table-layout:fixed}
    th,td{border:1px solid #c8c8c8;padding:3px 6px;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
    th{background:#f1f1f4;font-weight:600;text-align:left}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
  </style></head><body><h1>${escapeHtml(options.title)}</h1><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}
