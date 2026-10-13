"use client";

import { useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import { controlClass } from "@/app/_components/_ui/field";

/** Text colours that read on the dark sheet. */
export const SHEET_TEXT_COLORS = [
  "#F1F3F9", "#949AA8", "#F28B82", "#F6AEA9", "#FDD663", "#FDE293", "#81C995", "#A8DAB5",
  "#78D9EC", "#8AB4F8", "#AECBFA", "#C58AF9", "#D7AEFB", "#FF8BCB", "#FCAD70", "#E6C9A8",
];

/** Muted fills that keep white text readable. */
export const SHEET_FILL_COLORS = [
  "#202124", "#3C4043", "#5F2120", "#7A2E0E", "#614A19", "#5C3A12", "#1E4620", "#137333",
  "#0D4F4A", "#0B4F71", "#174EA6", "#2A2445", "#4A2D73", "#7627BB", "#6B1F4A", "#3B2F2F",
];

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const [, r, g, b] = withHash;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

/**
 * A swatch grid with a "none" chip and a hex field for any other colour.
 */
export default function SheetColorSwatches({
  colors,
  value,
  onPick,
  noneLabel = "None",
}: {
  colors: string[];
  value?: string;
  onPick: (color: string | undefined) => void;
  noneLabel?: string;
}) {
  const [hex, setHex] = useState(value ?? "");
  const current = value?.toUpperCase();
  const apply = () => {
    const normalized = normalizeHex(hex);
    if (normalized) onPick(normalized);
  };
  return (
    <div className="w-[212px]">
      <div className="grid grid-cols-8 gap-1">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={color}
            onClick={() => onPick(color)}
            className="flex size-[22px] items-center justify-center rounded-md ring-1 ring-inset ring-white/10 transition hover:scale-110"
            style={{ background: color }}
          >
            {current === color.toUpperCase() ? <Check className="size-3 text-white mix-blend-difference" /> : null}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPick(undefined)}
          className="h-7 shrink-0 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {noneLabel}
        </button>
        <span
          className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-white/15"
          style={{ background: normalizeHex(hex) ?? "transparent" }}
        />
        <input
          value={hex}
          onChange={(event) => setHex(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
          onBlur={apply}
          placeholder="#hex"
          aria-label="Custom colour"
          spellCheck={false}
          className={controlClass("sm", "min-w-0 flex-1 font-mono text-[11px]")}
        />
      </div>
    </div>
  );
}
