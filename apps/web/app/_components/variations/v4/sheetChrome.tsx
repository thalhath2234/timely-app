import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/** Enough row numbers to run past the bottom of either page; the gutter clips the rest. */
const ROWS = Array.from({ length: 320 }, (_, i) => i + 1);

/**
 * The sheet around a page: a corner cell, the column letters, the row gutter
 * and the main column with 44px row lines. Everything inside lays itself out
 * freely; the chrome only frames it.
 */
export function SheetFrame({
  letters,
  cols,
  children,
  className,
  mainClassName,
}: {
  letters: string[];
  /** A grid template for the letters when they should follow a table's columns. */
  cols?: string;
  children: ReactNode;
  className?: string;
  mainClassName?: string;
}) {
  return (
    <div className={cn("v4-sheet v-container", className)}>
      <div className="v4-corner" aria-hidden />
      <div className="v4-cols" aria-hidden style={cols ? ({ "--cols": cols } as React.CSSProperties) : undefined}>
        {letters.map((letter) => (
          <span key={letter}>{letter}</span>
        ))}
      </div>
      <div className="v4-gutter" aria-hidden>
        <div className="v4-gutter-rows">
          {ROWS.map((row) => (
            <span key={row}>{row}</span>
          ))}
        </div>
      </div>
      <div className={cn("v4-main", mainClassName)}>{children}</div>
    </div>
  );
}

/** A section header as a named range: `how_it_works  A24:H31`, then the title. */
export function RangeHeader({
  name,
  range,
  title,
  lede,
  id,
  as: Tag = "h2",
  className,
}: {
  name: string;
  range: string;
  title: ReactNode;
  lede?: ReactNode;
  id?: string;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="v4-range" aria-hidden>
        <span className="v4-range-name">{name}</span>
        <span className="v4-range-addr">{range}</span>
        <span className="v4-range-rule" />
      </div>
      <Tag id={id} className="v4-display mt-3 max-w-[22ch] text-[2rem] leading-[1.02] sm:text-[2.6rem]">
        {title}
      </Tag>
      {lede ? <p className="mt-4 max-w-[58ch] text-base leading-relaxed text-[var(--v-soft)] sm:text-[1.0625rem]">{lede}</p> : null}
    </div>
  );
}

/** The header row of a table: column letter + name per cell. */
export function TableHead({ cols, columns, className }: { cols: string; columns: { letter: string; label: string; className?: string }[]; className?: string }) {
  return (
    <div className={cn("v4-thead", className)} style={{ "--cols": cols } as React.CSSProperties} aria-hidden>
      {columns.map((column) => (
        <span key={column.letter} className={column.className}>
          <b>{column.letter}</b>
          {column.label}
        </span>
      ))}
    </div>
  );
}
