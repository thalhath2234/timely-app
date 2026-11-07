"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { formatMoney } from "@timely/contract/bots";
import { cn } from "@/app/utils/cn";

/** What goes before and after a number in a currency: "₹" and "", or "" and " CHF". */
export function moneyAffixes(currency: string): {
  before: string;
  after: string;
} {
  const one = formatMoney(1, currency);
  const at = one.indexOf("1");
  return { before: one.slice(0, at), after: one.slice(at + 1) };
}

/** "25000" → 25000; "25,000" and "₹ 25 000" too. Blank or not a number → undefined. */
export function parseAmount(text: string): number | undefined {
  const clean = text.replace(/[^\d.\-]/g, "");
  if (!clean) return undefined;
  const n = Number(clean);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * An editable value on the right of a grouped row: the value in a soft pill
 * with a pencil, typed in place ("₹25,000", "0.5%", "Add to cart"). It keeps
 * what is typed while it has focus and shows the saved value otherwise.
 */
export function EditPill({
  value,
  onChange,
  before,
  after,
  placeholder,
  numeric,
  mono,
  width = 140,
  invalid,
  "aria-label": ariaLabel,
}: {
  /** The text shown when not editing. */
  value: string;
  onChange: (text: string) => void;
  before?: string;
  after?: string;
  placeholder?: string;
  numeric?: boolean;
  mono?: boolean;
  /** The input's widest, in px; it grows with what is typed up to this. */
  width?: number;
  invalid?: boolean;
  "aria-label": string;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (!focused && value !== shown) {
    // The saved value changed under it (a save, a refetch): follow it.
    setShown(value);
    setText(value);
  }
  return (
    <label
      className={cn(
        "inline-flex h-8 min-w-0 cursor-text items-center gap-1 rounded-[10px] bg-fill px-2.5 text-[13px] font-medium tabular-nums text-foreground transition-shadow focus-within:ring-2 focus-within:ring-ring/30",
        invalid && "ring-1 ring-destructive/60",
      )}
    >
      {before ? <span className="text-muted-foreground">{before}</span> : null}
      <input
        value={text}
        placeholder={placeholder}
        inputMode={numeric ? "decimal" : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value);
        }}
        className={cn(
          "min-w-6 bg-transparent text-right outline-none [field-sizing:content] placeholder:text-muted-foreground/70",
          mono && "font-mono text-xs",
        )}
        style={{ maxWidth: width }}
      />
      {after ? <span className="text-muted-foreground">{after}</span> : null}
      <Pencil aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </label>
  );
}

/** A plain text value typed in place on the right of a grouped row (an address, a selector). */
export function RowInput({
  value,
  onChange,
  placeholder,
  mono,
  invalid,
  type = "text",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  invalid?: boolean;
  type?: "text" | "url";
  "aria-label": string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-8 w-80 max-w-full min-w-0 rounded-md bg-transparent px-2 text-right text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:bg-muted focus:bg-muted",
        mono && "font-mono text-xs",
        invalid && "text-destructive",
      )}
    />
  );
}
