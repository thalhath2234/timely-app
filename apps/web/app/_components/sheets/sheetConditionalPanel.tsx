"use client";

import { useState } from "react";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import type { SheetColumn, SheetConditionalFormat } from "@/app/_types/types";
import { SHEET_CONDITION_OPERATORS } from "@timely/contract/sheetTypes";
import { conditionValueCount, SHEET_CONDITION_LABELS } from "@timely/contract/sheetDisplay";
import Select from "@/app/_components/_ui/select";
import { controlClass } from "@/app/_components/_ui/field";
import { buttonClass } from "@/app/_components/_ui/button";
import { newColumnId } from "@/app/utils/sheetColumns";

/** Ready-made looks: a fill with a text colour that reads on it. */
const STYLES: { label: string; fillColor?: string; textColor?: string }[] = [
  { label: "Red", fillColor: "#5F2120", textColor: "#F6AEA9" },
  { label: "Amber", fillColor: "#5C3A12", textColor: "#FDE293" },
  { label: "Green", fillColor: "#1E4620", textColor: "#A8DAB5" },
  { label: "Blue", fillColor: "#174EA6", textColor: "#D2E3FC" },
  { label: "Purple", fillColor: "#4A2D73", textColor: "#D7AEFB" },
  { label: "Red text", textColor: "#F28B82" },
  { label: "Green text", textColor: "#81C995" },
];

function ruleSummary(rule: SheetConditionalFormat, columns: SheetColumn[]) {
  const column = columns.find((item) => item.id === rule.columnId)?.name ?? "?";
  const count = conditionValueCount(rule.operator);
  const values = count === 0 ? "" : count === 2 ? ` ${rule.value ?? ""} and ${rule.value2 ?? ""}` : ` ${rule.value ?? ""}`;
  return `${column}: ${SHEET_CONDITION_LABELS[rule.operator].toLowerCase()}${values}`;
}

/**
 * Colour rules for the open tab: list, add and remove. A rule colours cells
 * of one column (or their whole rows) when their value passes a test.
 */
export default function SheetConditionalPanel({
  columns,
  rules,
  defaultColumnId,
  onChange,
}: {
  columns: SheetColumn[];
  rules: SheetConditionalFormat[];
  defaultColumnId?: string;
  onChange: (rules: SheetConditionalFormat[]) => void;
}) {
  const [adding, setAdding] = useState(rules.length === 0);
  const [draft, setDraft] = useState<SheetConditionalFormat>(() => ({
    id: "",
    columnId: defaultColumnId ?? columns[0]?.id ?? "",
    operator: "gt",
    value: "",
    fillColor: STYLES[0].fillColor,
    textColor: STYLES[0].textColor,
  }));
  const count = conditionValueCount(draft.operator);
  const canSave =
    Boolean(draft.columnId) &&
    (count === 0 || (draft.value ?? "").trim() !== "") &&
    (count < 2 || (draft.value2 ?? "").trim() !== "");

  const save = () => {
    if (!canSave) return;
    const rule: SheetConditionalFormat = {
      ...draft,
      id: newColumnId().replace("col_", "cf_"),
      value: count > 0 ? draft.value?.trim() : undefined,
      value2: count > 1 ? draft.value2?.trim() : undefined,
    };
    onChange([...rules, rule]);
    setAdding(false);
    setDraft((current) => ({ ...current, value: "", value2: "" }));
  };

  return (
    <div className="w-80 p-1 text-xs">
      <p className="mb-2 px-1 text-[11px] font-medium text-foreground">Colour rules</p>
      {rules.length === 0 && !adding ? (
        <p className="px-1 pb-2 text-muted-foreground">No rules on this tab yet.</p>
      ) : null}
      <ul className="space-y-1">
        {rules.map((rule) => (
          <li key={rule.id} className="flex items-center gap-2 rounded-md bg-card px-2 py-1.5">
            <span
              className="flex h-5 w-7 shrink-0 items-center justify-center rounded text-[10px] font-semibold ring-1 ring-inset ring-white/10"
              style={{ background: rule.fillColor, color: rule.textColor, fontWeight: rule.bold ? 700 : undefined }}
            >
              Aa
            </span>
            <span className="min-w-0 flex-1 truncate" title={ruleSummary(rule, columns)}>
              {ruleSummary(rule, columns)}
              {rule.wholeRow ? <span className="text-muted-foreground"> · whole row</span> : null}
            </span>
            <button
              type="button"
              title="Remove rule"
              aria-label="Remove rule"
              onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-2 space-y-2 rounded-lg border border-border p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Select
              size="sm"
              value={draft.columnId}
              onChange={(columnId) => setDraft({ ...draft, columnId })}
              options={columns.map((column) => ({ value: column.id, label: column.name }))}
              aria-label="Column"
            />
            <Select
              size="sm"
              value={draft.operator}
              onChange={(operator) => setDraft({ ...draft, operator: operator as SheetConditionalFormat["operator"] })}
              options={SHEET_CONDITION_OPERATORS.map((operator) => ({ value: operator, label: SHEET_CONDITION_LABELS[operator] }))}
              aria-label="Test"
            />
          </div>
          {count > 0 ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={draft.value ?? ""}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                onKeyDown={(event) => event.key === "Enter" && save()}
                placeholder={draft.operator === "contains" || draft.operator === "notContains" ? "Text" : "Number, date or text"}
                aria-label="Value"
                className={controlClass("sm", "min-w-0 flex-1 text-xs")}
              />
              {count === 2 ? (
                <>
                  <span className="text-muted-foreground">and</span>
                  <input
                    value={draft.value2 ?? ""}
                    onChange={(event) => setDraft({ ...draft, value2: event.target.value })}
                    onKeyDown={(event) => event.key === "Enter" && save()}
                    aria-label="Second value"
                    className={controlClass("sm", "min-w-0 flex-1 text-xs")}
                  />
                </>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {STYLES.map((style) => {
              const active = draft.fillColor === style.fillColor && draft.textColor === style.textColor;
              return (
                <button
                  key={style.label}
                  type="button"
                  title={style.label}
                  aria-label={style.label}
                  aria-pressed={active}
                  onClick={() => setDraft({ ...draft, fillColor: style.fillColor, textColor: style.textColor })}
                  className={`flex h-6 w-8 items-center justify-center rounded text-[10px] font-semibold ring-1 ring-inset ${
                    active ? "ring-2 ring-ring" : "ring-white/10"
                  }`}
                  style={{ background: style.fillColor ?? "transparent", color: style.textColor }}
                >
                  Aa
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(draft.bold)}
                onChange={(event) => setDraft({ ...draft, bold: event.target.checked || undefined })}
                className="accent-[#6E56CF]"
              />
              Bold
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(draft.wholeRow)}
                onChange={(event) => setDraft({ ...draft, wholeRow: event.target.checked || undefined })}
                className="accent-[#6E56CF]"
              />
              Colour the whole row
            </label>
          </div>
          <div className="flex justify-end gap-1">
            {rules.length > 0 ? (
              <button type="button" onClick={() => setAdding(false)} className={buttonClass({ variant: "ghost", size: "sm" })}>
                Cancel
              </button>
            ) : null}
            <button type="button" disabled={!canSave} onClick={save} className={buttonClass({ size: "sm" })}>
              Add rule
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-primary hover:bg-accent/60"
        >
          <Plus className="size-3.5" />
          Add a rule
        </button>
      )}
    </div>
  );
}
