"use client";

import { useMemo, useState } from "react";
import { controlClass } from "@/app/_components/_ui/field";
import { buttonClass } from "@/app/_components/_ui/button";

const MAX_VALUES = 300;
export const BLANK_FILTER_VALUE = "";

/**
 * Pick which values of a column stay visible. `values` are the column's
 * shown values; `selected` is the current allow-list, or null for all.
 */
export default function SheetColumnFilter({
  columnName,
  values,
  selected,
  onApply,
  onClose,
}: {
  columnName: string;
  values: string[];
  selected: string[] | null;
  onApply: (allowed: string[] | null) => void;
  onClose: () => void;
}) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
    return [...map.entries()]
      .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })))
      .slice(0, MAX_VALUES);
  }, [values]);
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected ?? counts.map(([value]) => value)));
  const shown = counts.filter(([value]) => value.toLowerCase().includes(query.trim().toLowerCase()));

  const toggle = (value: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  return (
    <div className="w-60 p-1 text-xs">
      <p className="mb-1.5 truncate px-1 text-[11px] font-medium text-foreground">Show rows where {columnName} is</p>
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search values"
        aria-label="Search values"
        className={controlClass("sm", "w-full text-xs")}
      />
      <div className="mt-1.5 flex gap-3 px-1 text-[11px]">
        <button type="button" className="text-primary hover:underline" onClick={() => setChecked(new Set(counts.map(([value]) => value)))}>
          Select all
        </button>
        <button type="button" className="text-primary hover:underline" onClick={() => setChecked(new Set())}>
          Clear
        </button>
      </div>
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {shown.map(([value, count]) => (
          <li key={value || "__blank"}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent/60">
              <input type="checkbox" checked={checked.has(value)} onChange={() => toggle(value)} className="accent-[#6E56CF]" />
              <span className={`min-w-0 flex-1 truncate ${value === "" ? "italic text-muted-foreground" : ""}`}>
                {value === "" ? "(Blank)" : value}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 ? <li className="px-1 py-2 text-muted-foreground">No matching values</li> : null}
      </ul>
      <div className="mt-2 flex justify-end gap-1">
        <button type="button" onClick={onClose} className={buttonClass({ variant: "ghost", size: "sm" })}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApply(checked.size === counts.length ? null : [...checked])}
          className={buttonClass({ size: "sm" })}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
