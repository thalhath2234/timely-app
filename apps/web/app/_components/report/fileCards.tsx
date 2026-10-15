"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Check,
  ExternalLink,
  FileText,
  Gauge,
  Hash,
  LineChart as LineIcon,
  ListChecks,
  ListPlus,
  Minus,
  PieChart,
  Plus,
  Table2,
  Tally5,
} from "lucide-react";
import type { CardQuery, DashboardCard, DashboardData, SeriesPoint } from "@timely/contract/dashboard";
import {
  addPickRow,
  computeSheetCard,
  formatLike,
  pickDocBlocks,
  pickDocChecks,
  setPickCell,
  toggleDocCheck,
  type AddRowField,
  type DocPick,
  type DocView,
  type PickCell,
  type SheetCardResult,
  type SheetPick,
  type SheetView,
  pickRangeText,
} from "@timely/contract/dashboardFiles";
import type { DocContent } from "@timely/contract/documents";
import type { Sheet as ContractSheet, UpdateSheetPayload } from "@timely/contract/sheet";
import type { Doc, Sheet } from "@/app/_types/types";
import { apiUrl } from "@/app/utils/api/client";
import { updateDoc } from "@/app/utils/api/docs";
import { updateSheet } from "@/app/utils/api/sheets";
import { docKey, docsKey } from "@/app/utils/hooks/docs";
import { sheetKey, sheetsKey } from "@/app/utils/hooks/sheets";
import { fileHref } from "@/app/utils/fileRoutes";
import { useToastStore } from "@/app/_store/toastStore";
import { cn } from "@/app/utils/cn";
import Button from "@/app/_components/_ui/button";
import Select from "@/app/_components/_ui/select";
import DatePicker from "@/app/_components/_ui/datePicker";
import { controlClass } from "@/app/_components/_ui/field";
import { CategoryBars, DonutChart, LineChart, Meter, seriesColor } from "./charts";

export const FILE_ICON: Record<SheetView | DocView, typeof Hash> = {
  value: Hash,
  table: Table2,
  bar: BarChart3,
  line: LineIcon,
  pie: PieChart,
  progress: Gauge,
  counter: Tally5,
  addRow: ListPlus,
  page: FileText,
  checklist: ListChecks,
};

/** True for a custom card that reads one sheet or one doc. */
export function isFileQuery(query: CardQuery | undefined): query is CardQuery & ({ sheet: SheetPick } | { doc: DocPick }) {
  return Boolean(query?.sheet || query?.doc);
}

/**
 * Keeps sheets and docs that cards on the board read up to date, whoever
 * changes them (this app, the phone, an agent): each picked file has a watch
 * stream, and every save it reports lands in the query cache the cards read.
 */
export function useFileWatches(cards: DashboardCard[]) {
  const queryClient = useQueryClient();
  const ids = useMemo(() => {
    const sheets = new Set<string>();
    const docs = new Set<string>();
    for (const card of cards) {
      if (card.query?.sheet?.sheetId) sheets.add(card.query.sheet.sheetId);
      if (card.query?.doc?.docId) docs.add(card.query.doc.docId);
    }
    return { sheets: [...sheets].sort().join(","), docs: [...docs].sort().join(",") };
  }, [cards]);

  useEffect(() => {
    const streams: EventSource[] = [];
    const watch = (path: string, onDocument: (document: unknown) => void, onDeleted: () => void) => {
      const source = new EventSource(apiUrl(path), { withCredentials: true });
      const read = (event: MessageEvent) => {
        try {
          const data = JSON.parse(String(event.data)) as { document?: unknown };
          if (data.document) onDocument(data.document);
        } catch {
          // ignore a malformed frame
        }
      };
      source.addEventListener("updated", read);
      source.addEventListener("deleted", onDeleted);
      streams.push(source);
    };
    for (const id of ids.sheets.split(",").filter(Boolean)) {
      watch(
        `/sheets/${id}/watch`,
        (document) => {
          const sheet = document as Sheet;
          queryClient.setQueryData(sheetKey(id), sheet);
          queryClient.setQueryData<Sheet[]>(sheetsKey, (list) => list?.map((item) => (item.id === id ? sheet : item)));
        },
        () => void queryClient.invalidateQueries({ queryKey: sheetsKey }),
      );
    }
    for (const id of ids.docs.split(",").filter(Boolean)) {
      watch(
        `/docs/${id}/watch`,
        (document) => {
          const doc = document as Doc;
          queryClient.setQueryData(docKey(id), doc);
          queryClient.setQueryData<Doc[]>(docsKey, (list) => list?.map((item) => (item.id === id ? doc : item)));
        },
        () => void queryClient.invalidateQueries({ queryKey: docsKey }),
      );
    }
    // The streams miss what happened while the window slept; catch up on return.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (ids.sheets) void queryClient.invalidateQueries({ queryKey: sheetsKey, exact: true });
      if (ids.docs) void queryClient.invalidateQueries({ queryKey: docsKey, exact: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      for (const source of streams) source.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ids, queryClient]);
}

/** Saves a change a card made to a sheet, showing it at once and undoing it if the save fails. */
function useSheetWrite() {
  const queryClient = useQueryClient();
  return async (before: Sheet, change: { payload: UpdateSheetPayload; sheet: ContractSheet } | null, done?: string) => {
    if (!change) return false;
    const put = (sheet: Sheet) => {
      queryClient.setQueryData(sheetKey(sheet.id), sheet);
      queryClient.setQueryData<Sheet[]>(sheetsKey, (list) => list?.map((item) => (item.id === sheet.id ? sheet : item)));
    };
    put(change.sheet as Sheet);
    try {
      put(await updateSheet(before.id, change.payload as Parameters<typeof updateSheet>[1]));
      if (done) useToastStore.getState().show(done);
      return true;
    } catch (error) {
      put(before);
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not save to the sheet");
      return false;
    }
  };
}

function useDocWrite() {
  const queryClient = useQueryClient();
  return async (before: Doc, content: DocContent) => {
    const put = (doc: Doc) => {
      queryClient.setQueryData(docKey(doc.id), doc);
      queryClient.setQueryData<Doc[]>(docsKey, (list) => list?.map((item) => (item.id === doc.id ? doc : item)));
    };
    put({ ...before, content });
    try {
      put(await updateDoc(before.id, { content }));
    } catch (error) {
      put(before);
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not save to the doc");
    }
  };
}

/** A card built from one sheet or doc. `preview` draws it without writing back (the workshop). */
export default function FileCardView({ query, data, preview = false }: { query: CardQuery; data: DashboardData; preview?: boolean }) {
  if (query.sheet) {
    const sheet = (data.sheets ?? []).find((entry) => entry.id === query.sheet!.sheetId) as Sheet | undefined;
    return <SheetCard pick={query.sheet} sheet={sheet} color={query.color ?? 0} preview={preview} />;
  }
  if (query.doc) {
    const doc = (data.docs ?? []).find((entry) => entry.id === query.doc!.docId) as Doc | undefined;
    return <DocCard pick={query.doc} doc={doc} preview={preview} />;
  }
  return null;
}

function Footer({ children, href }: { children: ReactNode; href?: string }) {
  const router = useRouter();
  return (
    <div className="flex min-w-0 items-center gap-1.5 pt-1.5 text-[11px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {href ? (
        <button type="button" onClick={() => router.push(href)} className="flex shrink-0 items-center gap-1 rounded px-1 hover:text-foreground" aria-label="Open the file">
          <ExternalLink className="size-3" />
          Open
        </button>
      ) : null}
    </div>
  );
}

function Missing({ text }: { text: string }) {
  return <p className="flex h-full items-center justify-center px-2 text-center text-sm text-muted-foreground">{text}</p>;
}

// ---- Sheets ----

function SheetCard({ pick, sheet, color, preview }: { pick: SheetPick; sheet: Sheet | undefined; color: number; preview: boolean }) {
  const result = useMemo(() => computeSheetCard(sheet as ContractSheet | undefined, pick), [sheet, pick]);
  const write = useSheetWrite();
  const where = `${sheet?.title || pick.fileTitle || "Sheet"} · ${pickRangeText(sheet as ContractSheet | undefined, pick)}`;
  const href = sheet && !preview ? fileHref(sheet.id) : undefined;
  const footer = <Footer href={href}>{where}</Footer>;
  if (result.kind === "missing") return <Missing text={sheet === undefined && !pick.sheetId ? "Pick a sheet." : result.message} />;

  const setCell = (cell: PickCell, input: string, done?: string) =>
    sheet && !preview ? write(sheet, setPickCell(sheet as ContractSheet, pick.tabId, cell.rowId, cell.colId, input), done) : Promise.resolve(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <SheetBody result={result} pick={pick} color={color} preview={preview} onSetCell={setCell} onAddRow={(values) => (sheet && !preview ? write(sheet, addPickRow(sheet as ContractSheet, pick, values), `Added a row to ${sheet.title || "the sheet"}`) : Promise.resolve(false))} />
      </div>
      {footer}
    </div>
  );
}

function SheetBody({
  result,
  pick,
  color,
  preview,
  onSetCell,
  onAddRow,
}: {
  result: Exclude<SheetCardResult, { kind: "missing" }>;
  pick: SheetPick;
  color: number;
  preview: boolean;
  onSetCell: (cell: PickCell, input: string, done?: string) => Promise<boolean>;
  onAddRow: (values: Record<string, string>) => Promise<boolean>;
}) {
  switch (result.kind) {
    case "value":
      return (
        <div className="flex h-full flex-col justify-end">
          <div className="flex items-end gap-2">
            <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: seriesColor(color) }} aria-hidden />
            <span className="truncate text-4xl font-semibold leading-none tabular-nums text-foreground">{result.text || "–"}</span>
          </div>
          <p className="mt-2 truncate text-xs text-muted-foreground">
            {result.label ?? (result.count > 1 ? `Total of ${result.count} cells` : " ")}
          </p>
        </div>
      );
    case "counter": {
      const cell = result.cell;
      const locked = !cell || cell.formula;
      const bump = (by: number) => cell && void onSetCell(cell, String(Math.round((result.value + by) * 1e9) / 1e9));
      return (
        <div className="flex h-full flex-col justify-center gap-2">
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" icon size="lg" className="size-11 rounded-xl" disabled={locked || preview} onClick={() => bump(-result.step)} aria-label={`Take away ${result.step}`}>
              <Minus />
            </Button>
            <span className="min-w-0 truncate text-center text-4xl font-semibold tabular-nums text-foreground">{result.text || "0"}</span>
            <Button icon size="lg" className="size-11 rounded-xl" disabled={locked || preview} onClick={() => bump(result.step)} aria-label={`Add ${result.step}`}>
              <Plus />
            </Button>
          </div>
          <p className="truncate text-center text-xs text-muted-foreground">{locked ? "This cell holds a formula, so it can't be counted here." : result.label ?? "Saves into the sheet"}</p>
        </div>
      );
    }
    case "progress": {
      const share = result.target > 0 ? result.value / result.target : 0;
      return (
        <div className="flex h-full flex-col justify-end gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-3xl font-semibold tabular-nums text-foreground">{result.target > 0 ? `${Math.round(share * 100)}%` : "–"}</span>
            <span className="truncate text-xs tabular-nums text-muted-foreground">
              {result.target > 0 ? `${result.valueText} of ${result.targetText}` : "Set a goal in the card's settings"}
            </span>
          </div>
          <Meter value={share} color={share > 1 ? "var(--destructive)" : color} />
          {result.label ? <p className="truncate text-xs text-muted-foreground">{result.label}</p> : null}
        </div>
      );
    }
    case "table":
      return <SheetTable result={result} preview={preview} onSetCell={onSetCell} />;
    case "chart": {
      const format = (value: number) => formatLike(value, result.column);
      const toPoints = (points: { key: string; label: string; value: number }[]): SeriesPoint[] => points.map((point) => ({ key: point.key, label: point.label, value: point.value }));
      const first = result.series[0];
      if (!first || first.points.length === 0) return <Missing text="No numbers in these cells yet." />;
      if (result.view === "pie") {
        const total = first.points.reduce((sum, point) => sum + point.value, 0);
        return <DonutChart points={toPoints(first.points)} unit="count" total={total} format={format} />;
      }
      if (result.view === "line") return <LineChart points={toPoints(first.points)} unit="count" color={color} format={format} />;
      if (result.series.length === 1) return <CategoryBars points={toPoints(first.points)} unit="count" color={color} format={format} />;
      return <GroupedBars series={result.series} color={color} format={format} />;
    }
    case "addRow":
      return <AddRowForm fields={result.fields} preview={preview} onAdd={onAddRow} tabName={result.tabName} />;
  }
  void pick;
}

/** Bars for several value columns side by side per row, with a legend. */
function GroupedBars({ series, color, format }: { series: { name: string; points: { key: string; label: string; value: number; text: string }[] }[]; color: number; format: (value: number) => string }) {
  const max = Math.max(...series.flatMap((entry) => entry.points.map((point) => point.value)), 0) || 1;
  const labels = series[0].points;
  return (
    <div className="flex h-full flex-col gap-2">
      <ul className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
        {labels.map((label, row) => (
          <li key={label.key} className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-center gap-2 text-xs">
            <span className="truncate text-foreground" title={label.label}>
              {label.label}
            </span>
            <span className="flex flex-col gap-0.5">
              {series.map((entry, index) => {
                const point = entry.points[row];
                const value = point?.value ?? 0;
                return (
                  <span key={entry.name} className="flex items-center gap-2" title={`${entry.name}: ${point?.text ?? format(value)}`}>
                    <span className="h-1.5 rounded-r-[3px]" style={{ width: `${Math.max((value / max) * 100, value > 0 ? 2 : 0)}%`, background: seriesColor((color + index) % 8) }} />
                    {index === series.length - 1 ? null : null}
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {series.map((entry, index) => (
          <span key={entry.name} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: seriesColor((color + index) % 8) }} />
            {entry.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function SheetTable({
  result,
  preview,
  onSetCell,
}: {
  result: Extract<SheetCardResult, { kind: "table" }>;
  preview: boolean;
  onSetCell: (cell: PickCell, input: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const numeric = (cell: PickCell) => cell.number !== null || ["number", "currency", "percent", "formula"].includes(cell.column.type);
  const canEdit = (cell: PickCell) => result.editable && !preview && !cell.formula;
  const commit = (cell: PickCell) => {
    setEditing(null);
    if (draft !== (cell.raw ?? "")) void onSetCell(cell, draft);
  };
  if (result.rows.length === 0) return <Missing text="These cells are empty." />;
  return (
    <div className="h-full overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs tabular-nums">
        {result.headers ? (
          <thead className="sticky top-0 bg-muted text-muted-foreground">
            <tr>
              {result.headers.map((header, index) => (
                <th key={index} className={cn("px-2 py-1.5 text-left font-medium", result.columns[index] && ["number", "currency", "percent", "formula"].includes(result.columns[index].type) && "text-right")}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={row[0]?.rowId ?? rowIndex} className="border-t border-border first:border-t-0">
              {row.map((cell) => {
                const key = `${cell.rowId}:${cell.colId}`;
                const editable = canEdit(cell);
                if (cell.column.type === "boolean" && editable) {
                  const on = cell.value.type === "boolean" ? cell.value.value : /^true$/i.test(cell.raw);
                  return (
                    <td key={key} className="px-2 py-1">
                      <input type="checkbox" checked={on} onChange={(event) => void onSetCell(cell, event.target.checked ? "TRUE" : "FALSE")} className="accent-[var(--primary)]" aria-label={`${cell.address}`} />
                    </td>
                  );
                }
                return (
                  <td key={key} className={cn("px-2 py-1", numeric(cell) && "text-right", cell.formula && "text-muted-foreground")}>
                    {editing === key ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commit(cell)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commit(cell);
                          if (event.key === "Escape") setEditing(null);
                        }}
                        className={controlClass("sm", "h-6 w-full min-w-16 px-1.5 text-xs")}
                        aria-label={`Edit ${cell.address}`}
                      />
                    ) : editable ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(cell.raw);
                          setEditing(key);
                        }}
                        className={cn("-mx-1 block w-[calc(100%+0.5rem)] truncate rounded px-1 text-inherit hover:bg-accent", numeric(cell) ? "text-right" : "text-left")}
                        aria-label={`Edit ${cell.address}: ${cell.text || "empty"}`}
                      >
                        {cell.text || " "}
                      </button>
                    ) : (
                      <span className="block truncate">{cell.text}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddRowForm({ fields, preview, onAdd, tabName }: { fields: AddRowField[]; preview: boolean; onAdd: (values: Record<string, string>) => Promise<boolean>; tabName: string }) {
  const empty = () => Object.fromEntries(fields.map((field) => [field.colId, ""]));
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [saving, setSaving] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const set = (colId: string, value: string) => setValues((current) => ({ ...current, [colId]: value }));
  const filled = Object.values(values).some((value) => value.trim() !== "");
  const submit = async () => {
    if (!filled || saving) return;
    setSaving(true);
    const ok = await onAdd(values);
    setSaving(false);
    if (ok) {
      setValues(empty());
      first.current?.focus();
    }
  };
  if (fields.length === 0) return <Missing text="Every picked column holds a formula, so there is nothing to fill in." />;
  return (
    <form
      className="flex h-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 overflow-y-auto">
        {fields.map((field, index) => (
          <label key={field.colId} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            <span className="truncate">{field.name}</span>
            {field.type === "select" && field.options?.length ? (
              <Select size="sm" value={values[field.colId] ?? ""} onChange={(value) => set(field.colId, value)} options={[{ value: "", label: "–" }, ...field.options.map((option) => ({ value: option, label: option }))]} aria-label={field.name} />
            ) : field.type === "date" ? (
              <DatePicker size="sm" value={values[field.colId] ?? ""} onChange={(value) => set(field.colId, value)} aria-label={field.name} />
            ) : field.type === "boolean" ? (
              <span className="flex h-7 items-center">
                <input type="checkbox" checked={values[field.colId] === "TRUE"} onChange={(event) => set(field.colId, event.target.checked ? "TRUE" : "")} className="accent-[var(--primary)]" aria-label={field.name} />
              </span>
            ) : (
              <input
                ref={index === 0 ? first : undefined}
                value={values[field.colId] ?? ""}
                onChange={(event) => set(field.colId, event.target.value)}
                inputMode={["number", "currency", "percent"].includes(field.type) ? "decimal" : undefined}
                className={controlClass("sm", "w-full")}
                disabled={preview}
              />
            )}
          </label>
        ))}
      </div>
      <Button type="submit" size="sm" leading={<Plus />} loading={saving} disabled={preview || !filled}>
        Add row to {tabName}
      </Button>
    </form>
  );
}

// ---- Docs ----

function DocCard({ pick, doc, preview }: { pick: DocPick; doc: Doc | undefined; preview: boolean }) {
  const write = useDocWrite();
  const content = doc?.content as DocContent | undefined;
  const page = useMemo(() => pickDocBlocks(content, pick), [content, pick]);
  const list = useMemo(() => pickDocChecks(content, pick), [content, pick]);
  const blocks = page.blocks;
  const checks = list.checks;
  const lost = pick.section && !page.found ? <p className="mb-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">The heading “{pick.section}” is gone, so this shows the whole doc.</p> : null;
  if (!doc || doc.archivedAt) return <Missing text="This doc was deleted or archived. Edit the card to pick another." />;
  const toggle = (index: number, checked: boolean) => {
    if (preview || !content) return;
    void write(doc, toggleDocCheck(content, index, checked));
  };
  const footer = <Footer href={preview ? undefined : fileHref(doc.id)}>{doc.title || "Untitled doc"}</Footer>;

  if (pick.view === "checklist") {
    const done = checks.filter((item) => item.checked).length;
    const shown = pick.hideDone ? checks.filter((item) => !item.checked) : checks;
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {lost}
        {checks.length === 0 ? (
          <Missing text={pick.section && page.found ? "This section has no checkboxes yet." : "This doc has no checkboxes yet."} />
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
              <Meter value={checks.length ? done / checks.length : 0} color="var(--success)" className="flex-1" />
              <span>
                {done} of {checks.length}
              </span>
            </div>
            <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
              {shown.length === 0 ? <li className="px-1 py-2 text-sm text-muted-foreground">Everything is ticked.</li> : null}
              {shown.map((item) => (
                <li key={item.index}>
                  <CheckRow text={item.text} checked={item.checked} depth={item.depth} onToggle={(checked) => toggle(item.index, checked)} disabled={preview} />
                </li>
              ))}
            </ul>
          </>
        )}
        {footer}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-sm leading-relaxed text-foreground">
        {lost}
        {blocks.length === 0 ? <p className="text-muted-foreground">This doc is empty.</p> : null}
        {blocks.map((block, index) => {
          switch (block.kind) {
            case "heading":
              return (
                <p key={index} className={cn("mt-3 font-semibold first:mt-0", block.level <= 1 ? "text-base" : "text-sm")}>
                  {block.text}
                </p>
              );
            case "paragraph":
              return (
                <p key={index} className="mt-1.5 first:mt-0">
                  {block.text}
                </p>
              );
            case "bullet":
              return (
                <p key={index} className="mt-1 flex gap-2" style={{ paddingLeft: block.depth * 16 }}>
                  <span className="w-3 shrink-0 text-muted-foreground">{block.marker}</span>
                  <span className="min-w-0">{block.text}</span>
                </p>
              );
            case "check":
              return <CheckRow key={index} text={block.text} checked={block.checked} depth={block.depth} onToggle={(checked) => toggle(block.index, checked)} disabled={preview} compact />;
            case "quote":
              return (
                <p key={index} className="mt-1.5 border-l-2 border-border pl-3 text-muted-foreground">
                  {block.text}
                </p>
              );
            case "code":
              return (
                <pre key={index} className="mt-1.5 overflow-hidden rounded-md bg-muted px-2 py-1.5 text-xs">
                  {block.text}
                </pre>
              );
            case "divider":
              return <hr key={index} className="my-2 border-border" />;
            case "image":
              return (
                <p key={index} className="mt-1.5 text-xs text-muted-foreground">
                  [Image{block.alt ? `: ${block.alt}` : ""}]
                </p>
              );
          }
        })}
      </div>
      {footer}
    </div>
  );
}

function CheckRow({ text, checked, depth, onToggle, disabled, compact }: { text: string; checked: boolean; depth: number; onToggle: (checked: boolean) => void; disabled: boolean; compact?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onToggle(!checked)}
      className={cn("flex w-full items-start gap-2.5 rounded-md px-1 text-left transition-colors hover:bg-accent/50 disabled:hover:bg-transparent", compact ? "mt-1 py-0.5" : "py-1.5")}
      style={{ paddingLeft: 4 + depth * 18 }}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50",
        )}
        aria-hidden
      >
        {checked ? <Check className="size-3" /> : null}
      </span>
      <span className={cn("min-w-0 flex-1 text-sm", checked && "text-muted-foreground line-through")}>{text || "Empty item"}</span>
    </button>
  );
}
