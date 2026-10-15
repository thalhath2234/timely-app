"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import {
  DOC_VIEW_HINTS,
  DOC_VIEW_LABELS,
  SHEET_VIEWS,
  SHEET_VIEW_HINTS,
  SHEET_VIEW_LABELS,
  computeSheetCard,
  docSections,
  pickDocChecks,
  fitSheetPick,
  formatRange,
  parseRange,
  previewGrid,
  repick,
  setPickTarget,
  sheetTabs,
  suggestSheetPick,
  type DocPick,
  type DocView,
  type RangeBox,
  type SheetPick,
  type SheetView,
} from "@timely/contract/dashboardFiles";
import { columnIndexToLetter } from "@timely/contract/sheetRefs";
import type { Doc, Sheet } from "@/app/_types/types";
import type { Sheet as ContractSheet } from "@timely/contract/sheet";
import Select from "@/app/_components/_ui/select";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import { controlClass } from "@/app/_components/_ui/field";
import { cn } from "@/app/utils/cn";
import { FILE_ICON } from "./fileCards";

type FileEntry = { id: string; title: string; updatedAt?: string; archivedAt?: string | null };

/** "Read from": every file of the kind, or one picked file. Recent files are one click away, the rest are in a searchable list. */
export function FileChips({
  kind,
  files,
  selected,
  onSelect,
}: {
  kind: "sheets" | "docs";
  files: FileEntry[];
  /** The picked file, or null for "all". */
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const live = useMemo(
    () => files.filter((file) => !file.archivedAt).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    [files],
  );
  const recent = live.slice(0, 4);
  // A picked file further down the list keeps its chip.
  const picked = selected ? live.find((file) => file.id === selected) : undefined;
  const chips = picked && !recent.includes(picked) ? [...recent.slice(0, 3), picked] : recent;
  const rest = live.filter((file) => !chips.includes(file));
  const noun = kind === "sheets" ? "sheet" : "doc";
  const untitled = kind === "sheets" ? "Untitled sheet" : "Untitled doc";
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Read from">
      <span className="mr-1 text-xs text-muted-foreground">Read from</span>
      <Chip active={selected === null} onClick={() => onSelect(null)}>
        All {kind}
      </Chip>
      {chips.map((file) => (
        <Chip key={file.id} active={selected === file.id} onClick={() => onSelect(file.id)}>
          {file.title || untitled}
        </Chip>
      ))}
      {rest.length > 0 ? (
        <div className="w-40">
          <Select
            size="sm"
            searchable
            value=""
            placeholder={`Another ${noun}…`}
            onChange={(id) => id && onSelect(id)}
            options={rest.map((file) => ({ value: file.id, label: file.title || untitled }))}
            aria-label={`Pick another ${noun}`}
          />
        </div>
      ) : null}
      {live.length === 0 ? <span className="text-xs text-muted-foreground">No {kind} yet. Make one in Files to build a card from it.</span> : null}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-7 max-w-48 truncate rounded-full border px-3 text-xs transition-colors",
        active ? "border-primary bg-accent font-medium text-accent-foreground" : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/* ---------------- sheets ---------------- */

/** Pick a tab and drag across its cells, then choose how the card shows them. */
export function SheetPickPanel({ sheet, pick, onChange }: { sheet: Sheet; pick: SheetPick; onChange: (pick: SheetPick) => void }) {
  const contract = sheet as ContractSheet;
  const tabs = sheetTabs(contract);
  const tabId = pick.tabId ?? tabs[0]?.id ?? "";
  const result = useMemo(() => computeSheetCard(contract, pick), [contract, pick]);
  const box = parseRange(pick.range);
  const bodyRows = box && box.r1 !== null ? box.r1 - box.r0 + 1 : Infinity;
  const columnsInPick = useMemo(() => {
    if (result.kind === "table") return result.columns;
    const read = computeSheetCard(contract, { ...pick, view: "table" });
    return read.kind === "table" ? read.columns : [];
  }, [contract, pick, result]);
  const headers = useMemo(() => {
    const read = computeSheetCard(contract, { ...pick, view: "table" });
    return read.kind === "table" ? read.headers : null;
  }, [contract, pick]);
  const columnName = (index: number) => {
    const letter = box ? columnIndexToLetter(box.c0 + index) : "";
    const name = headers?.[index]?.trim() || columnsInPick[index]?.name;
    return name ? `${letter} · ${name}` : letter;
  };

  const setView = (view: SheetView) => onChange(fitSheetPick({ ...pick, view }));

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pick cells</h3>
          <span className="text-xs text-muted-foreground">Drag across the cells the card should read.</span>
          <span className="flex-1" />
          <RangeInput value={pick.range} onCommit={(next) => onChange(repick(contract, pick, next))} />
        </div>
        {tabs.length > 1 ? (
          <div className="mb-2 overflow-x-auto">
            <SegmentedControl
              size="sm"
              value={tabId}
              onChange={(next) => onChange({ ...suggestSheetPick(contract, next || undefined), view: pick.view })}
              options={tabs.map((tab) => ({ value: tab.id, label: tab.name || "Untitled tab" }))}
              aria-label="Tab"
            />
          </div>
        ) : null}
        <MiniGrid sheet={contract} tabId={pick.tabId} pick={pick} onPick={(next) => onChange(repick(contract, pick, next))} />
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
          <Switch checked={Boolean(pick.headers)} disabled={bodyRows < 2} onChange={(on) => onChange(fitSheetPick({ ...pick, headers: on || undefined }))}>
            First row is names
          </Switch>
          <Switch checked={Boolean(pick.grow) || (box !== null && box.r1 === null)} disabled={box !== null && box.r1 === null} onChange={(on) => onChange(fitSheetPick({ ...pick, grow: on || undefined }))}>
            Keep reading rows added below
          </Switch>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Show as</h3>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {SHEET_VIEWS.map((view) => {
            const Icon = FILE_ICON[view];
            return (
              <ViewTile key={view} active={pick.view === view} onClick={() => setView(view)} icon={<Icon className="size-4" />} title={SHEET_VIEW_HINTS[view]}>
                {SHEET_VIEW_LABELS[view]}
              </ViewTile>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{SHEET_VIEW_HINTS[pick.view]}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {pick.view === "bar" || pick.view === "line" || pick.view === "pie" ? (
            <>
              <OptionField label="Names from">
                <Select
                  size="sm"
                  value={String(pick.labelCol ?? (columnsInPick.length > 1 ? 0 : -1))}
                  onChange={(value) => onChange(fitSheetPick({ ...pick, labelCol: Number(value) }))}
                  options={[{ value: "-1", label: "No names (cell addresses)" }, ...columnsInPick.map((_, index) => ({ value: String(index), label: columnName(index) }))]}
                />
              </OptionField>
              <OptionField label="Values from">
                <p className="flex h-7 items-center truncate text-xs text-foreground">
                  {result.kind === "chart" && result.series.length > 0 ? result.series.map((series) => series.name).join(", ") : "No numbers in these cells"}
                </p>
              </OptionField>
            </>
          ) : null}
          {pick.view === "progress" ? (
            <OptionField label="Goal" hint={result.kind === "progress" ? (result.target > 0 ? `Goal is ${result.targetText}.` : "Type a number, or a cell on this tab such as B7.") : undefined}>
              <TextInput value={pick.target ?? ""} placeholder="2000 or B7" onCommit={(target) => onChange(setPickTarget(contract, pick, target))} />
            </OptionField>
          ) : null}
          {pick.view === "counter" ? (
            <>
              <OptionField label="Each tap adds">
                <TextInput
                  value={String(pick.step ?? 1)}
                  inputMode="decimal"
                  onCommit={(text) => {
                    const step = Number(text);
                    onChange(fitSheetPick({ ...pick, step: Number.isFinite(step) && step > 0 ? step : undefined }));
                  }}
                />
              </OptionField>
              <OptionField label="Counts in">
                <p className="flex h-7 items-center text-xs text-foreground">
                  {result.kind === "counter" && result.cell ? `${result.cell.address}${result.cell.formula ? " (a formula, so it can't count)" : ""}` : "No cell"}
                </p>
              </OptionField>
            </>
          ) : null}
          {pick.view === "table" ? (
            <div className="col-span-2">
              <Switch checked={Boolean(pick.editable)} onChange={(on) => onChange(fitSheetPick({ ...pick, editable: on || undefined }))}>
                Edit values on the card (formula cells stay read-only)
              </Switch>
            </div>
          ) : null}
          {pick.view === "addRow" && result.kind === "addRow" ? (
            <p className="col-span-2 text-xs text-muted-foreground">
              New rows go right below {result.afterLabel} on {result.tabName}, so totals under the cells grow to include them. Columns with a formula copy it down.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function MiniGrid({ sheet, tabId, pick, onPick }: { sheet: ContractSheet; tabId: string | undefined; pick: SheetPick; onPick: (box: RangeBox) => void }) {
  const { grid, rows, cols } = useMemo(() => previewGrid(sheet, tabId), [sheet, tabId]);
  const stored = parseRange(pick.range);
  type Drag = { from: { r: number; c: number }; to: { r: number; c: number } } | null;
  const [drag, setDragState] = useState<Drag>(null);
  const dragRef = useRef<Drag>(null);
  const setDrag = (next: Drag) => {
    dragRef.current = next;
    setDragState(next);
  };

  useEffect(() => {
    if (!drag) return;
    const end = () => {
      const current = dragRef.current;
      dragRef.current = null;
      setDragState(null);
      if (!current) return;
      onPick({
        r0: Math.min(current.from.r, current.to.r),
        r1: Math.max(current.from.r, current.to.r),
        c0: Math.min(current.from.c, current.to.c),
        c1: Math.max(current.from.c, current.to.c),
      });
    };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
    // Only (re)bind when a drag starts or stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const box: RangeBox | null = drag
    ? { r0: Math.min(drag.from.r, drag.to.r), r1: Math.max(drag.from.r, drag.to.r), c0: Math.min(drag.from.c, drag.to.c), c1: Math.max(drag.from.c, drag.to.c) }
    : stored;
  const inBox = (r: number, c: number) => box !== null && c >= box.c0 && c <= box.c1 && r >= box.r0 && (box.r1 === null || r <= box.r1);

  if (rows === 0) return <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">This tab is empty.</p>;

  // Columns hidden in the sheet are left out of `grid`; place each cell by its address.
  const letters = Array.from({ length: cols }, (_, index) => columnIndexToLetter(index));
  const byAddress = new Map(grid.flat().map((cell) => [cell.address, cell]));
  const visibleCols = letters.map((letter, index) => ({ letter, index })).filter(({ letter }) => byAddress.has(`${letter}1`));
  const names = new Map(visibleCols.map(({ letter }) => [letter, byAddress.get(`${letter}1`)?.column.name ?? ""]));

  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-border bg-card text-xs tabular-nums select-none" style={{ touchAction: "none" }}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className="sticky left-0 z-10 w-8 bg-muted" />
            {visibleCols.map(({ letter, index }) => (
              <th key={letter} className={cn("px-2 py-1 text-left font-medium", box && index >= box.c0 && index <= box.c1 ? "text-primary" : "text-muted-foreground")}>
                {letter}
                {names.get(letter) && names.get(letter) !== letter ? <span className="ml-1.5 font-normal text-muted-foreground">{names.get(letter)}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r} className="border-t border-border/60">
              <th className={cn("sticky left-0 bg-muted px-1.5 py-1 text-right font-normal", inBox(r, box?.c0 ?? -1) ? "text-primary" : "text-muted-foreground")}>{r + 1}</th>
              {visibleCols.map(({ letter, index: c }) => {
                const cell = byAddress.get(`${letter}${r + 1}`);
                const selected = inBox(r, c);
                const isHeader = selected && pick.headers && !drag && box !== null && r === box.r0;
                const edges = selected
                  ? [
                      r === box!.r0 && "inset 0 2px 0 var(--primary)",
                      box!.r1 !== null && r === box!.r1 && "inset 0 -2px 0 var(--primary)",
                      c === box!.c0 && "inset 2px 0 0 var(--primary)",
                      c === box!.c1 && "inset -2px 0 0 var(--primary)",
                    ].filter(Boolean)
                  : [];
                return (
                  <td
                    key={letter}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      setDrag({ from: { r, c }, to: { r, c } });
                    }}
                    onPointerEnter={() => dragRef.current && setDrag({ ...dragRef.current, to: { r, c } })}
                    className={cn(
                      "max-w-36 cursor-cell truncate px-2 py-1",
                      cell?.number !== null && cell?.number !== undefined && "text-right",
                      selected ? "bg-primary/10 text-foreground" : "text-foreground/80 hover:bg-accent/50",
                      isHeader && "font-semibold",
                    )}
                    style={edges.length ? { boxShadow: edges.join(", ") } : undefined}
                    title={cell?.formula ? `${cell.address}: ${cell.raw}` : cell?.address}
                  >
                    {cell?.text || " "}
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

/** The picked range as text: shows the drag result, and takes a typed range for cells the mini grid doesn't show. */
function RangeInput(props: { value: string; onCommit: (box: RangeBox) => void }) {
  // Keyed by the stored range, so a drag on the grid replaces what was typed.
  return <RangeText key={props.value} {...props} />;
}

function RangeText({ value, onCommit }: { value: string; onCommit: (box: RangeBox) => void }) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  const commit = () => {
    const box = parseRange(text);
    if (!box) {
      setBad(true);
      return;
    }
    if (formatRange(box) !== value) onCommit(box);
  };
  return (
    <input
      value={text}
      onChange={(event) => {
        setText(event.target.value.toUpperCase());
        setBad(false);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      aria-label="Cells, as a range like A1:C6"
      aria-invalid={bad}
      spellCheck={false}
      className={controlClass("sm", cn("w-28 text-center font-mono tabular-nums", bad && "border-destructive"))}
    />
  );
}

/* ---------------- docs ---------------- */

export function DocPickPanel({ doc, pick, onChange }: { doc: Doc; pick: DocPick; onChange: (pick: DocPick) => void }) {
  const content = doc.content as never;
  const sections = useMemo(() => docSections(content), [content]);
  const all = useMemo(() => pickDocChecks(content, {}).checks, [content]);
  const { checks } = useMemo(() => pickDocChecks(content, pick), [content, pick]);
  const done = checks.filter((check) => check.checked).length;
  const tally = (count: number, ticked: number) => (count === 0 ? "No checkboxes" : `${ticked} of ${count} ticked`);
  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Part of the doc</h3>
          <span className="text-xs text-muted-foreground">The whole doc, or the part under one heading.</span>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-card p-1" role="radiogroup" aria-label="Part of the doc">
          <SectionRow active={!pick.section} onClick={() => onChange({ ...pick, section: undefined })} title={doc.title || "Untitled doc"} meta={tally(all.length, all.filter((check) => check.checked).length)} level={0} whole />
          {sections.map((section, index) => (
            <SectionRow
              key={`${section.text}-${index}`}
              active={pick.section === section.text}
              onClick={() => onChange({ ...pick, section: section.text })}
              title={section.text}
              meta={tally(section.checks, section.done)}
              level={section.level}
            />
          ))}
          {sections.length === 0 ? <p className="px-2.5 py-2 text-xs text-muted-foreground">No headings in this doc, so the card reads all of it.</p> : null}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Show as</h3>
        <div className="grid grid-cols-2 gap-1.5 sm:w-1/2">
          {(Object.keys(DOC_VIEW_LABELS) as DocView[]).map((view) => {
            const Icon = FILE_ICON[view];
            return (
              <ViewTile key={view} active={pick.view === view} onClick={() => onChange({ ...pick, view })} icon={<Icon className="size-4" />} title={DOC_VIEW_HINTS[view]}>
                {DOC_VIEW_LABELS[view]}
              </ViewTile>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {DOC_VIEW_HINTS[pick.view]} {checks.length > 0 ? `${checks.length === 1 ? "One checkbox" : `${checks.length} checkboxes`} here, ${done} ticked.` : "No checkboxes here yet."}
        </p>
        {pick.view === "checklist" ? (
          <div className="mt-3">
            <Switch checked={Boolean(pick.hideDone)} onChange={(on) => onChange({ ...pick, hideDone: on || undefined })}>
              Hide ticked items
            </Switch>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SectionRow({ active, onClick, title, meta, level, whole }: { active: boolean; onClick: () => void; title: string; meta: string; level: number; whole?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50",
      )}
      style={{ paddingLeft: 10 + Math.max(0, level - 1) * 14 }}
    >
      <span className={cn("min-w-0 flex-1 truncate", whole ? "font-medium" : level <= 1 ? "font-medium" : "")}>{whole ? `Whole doc · ${title}` : title}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>
      {active ? <Check className="size-3.5 shrink-0 text-primary" /> : <span className="size-3.5 shrink-0" />}
    </button>
  );
}

/* ---------------- small controls ---------------- */

function ViewTile({ active, onClick, icon, title, children }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border px-0.5 py-2 text-[11px] transition-colors",
        active ? "border-primary bg-accent font-medium text-accent-foreground" : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {icon}
      <span className="w-full truncate text-center">{children}</span>
    </button>
  );
}

function OptionField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1" role="group" aria-label={label}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

type TextInputProps = { value: string; placeholder?: string; inputMode?: "decimal"; onCommit: (value: string) => void };

function TextInput(props: TextInputProps) {
  return <TextInputField key={props.value} {...props} />;
}

function TextInputField({ value, placeholder, inputMode, onCommit }: TextInputProps) {
  const [text, setText] = useState(value);
  return (
    <input
      value={text}
      placeholder={placeholder}
      inputMode={inputMode}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(text.trim());
        }
      }}
      className={controlClass("sm", "w-full")}
    />
  );
}

/** An on/off switch, drawn like the ones in Settings. */
export function Switch({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm text-foreground", disabled && "cursor-default opacity-50")}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="relative block h-5 w-9 shrink-0 rounded-full bg-muted ring-1 ring-border transition-colors peer-checked:bg-primary peer-checked:ring-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 peer-checked:[&>span]:translate-x-4"
      >
        <span className="absolute left-0.5 top-0.5 block size-4 rounded-full bg-background shadow transition-transform" />
      </span>
      {children}
    </label>
  );
}
