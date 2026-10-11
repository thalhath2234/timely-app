"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { C } from "./data";
import { useSteps } from "./kinetic";

const ease = [0.7, 0, 0.2, 1] as const;

/* ---- Doc: Markdown becomes a heading, the slash menu adds a diagram, maths and a callout, then .md export ---- */

const MENU = ["Heading", "To-do list", "Table", "Diagram", "Math", "Callout"];
const DOC_MS = [1100, 900, 900, 700, 800, 1300, 1100, 1100, 2800];

export function DocGraphic() {
  const { ref, frame } = useSteps(DOC_MS);
  const heading = frame >= 2;
  const menu = frame === 3 || frame === 4;
  const diagram = frame >= 5;
  const math = frame >= 6;
  const callout = frame >= 7;
  const exported = frame >= 8;
  return (
    <div ref={ref} aria-hidden className="relative h-[440px] select-none overflow-hidden border border-[var(--line-2)] bg-[var(--panel)] sm:h-[460px]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line-2)] px-4 py-2.5">
        <span className="min-w-0 truncate text-[12px] text-[var(--soft)]">
          Website refresh <span className="text-[var(--faint)]">/</span> <span className="text-[var(--ink)]">Launch brief</span>
        </span>
        <span
          className="d4-mono inline-flex h-7 shrink-0 items-center px-2 text-[11px] font-semibold transition-colors duration-300"
          style={exported ? { background: C.blue.bg, color: C.blue.ink } : { border: "1px solid var(--line-2)", color: "var(--soft)" }}
        >
          Export .md
        </span>
      </div>
      <div className="px-4 pt-4 sm:px-5">
        <p className="text-[26px] leading-none font-extrabold tracking-[-0.045em]">Launch brief</p>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--soft)]">
          The new site ships on Tuesday 27 October. Owner: <span className="bg-[rgb(243_242_237/10%)] px-1 text-[var(--ink)]">@Website launch</span>
        </p>

        <div className="relative mt-4 h-7">
          <AnimatePresence mode="wait" initial={false}>
            {heading ? (
              <motion.p key="h" className="text-[19px] leading-7 font-bold tracking-[-0.03em]" initial={{ y: 10 }} animate={{ y: 0 }} transition={{ duration: 0.3, ease }}>
                Goals
              </motion.p>
            ) : (
              <motion.p key="md" className="d4-mono text-[14px] leading-7 text-[var(--soft)]" exit={{ opacity: 0 }}>
                {frame >= 1 ? "## Goals" : "## G"}
                <span className="d4-caret" />
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className="relative mt-2 min-h-[96px]">
          <AnimatePresence initial={false}>
            {diagram ? (
              <motion.div key="diagram" className="border border-[var(--line)] p-3" initial={{ clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} transition={{ duration: 0.6, ease }}>
                <p className="d4-mono text-[10px] text-[var(--faint)]">mermaid</p>
                <div className="mt-2 flex items-center">
                  {["Brief", "Build", "Launch"].map((node, index) => (
                    <div key={node} className="flex flex-1 items-center">
                      <span
                        className="flex h-9 flex-1 items-center justify-center text-[12px] font-bold"
                        style={index === 2 ? { background: C.blue.bg, color: C.blue.ink } : { border: "1px solid var(--line-2)" }}
                      >
                        {node}
                      </span>
                      {index < 2 ? <span className="h-px w-4 bg-[var(--line-2)] sm:w-6" /> : null}
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.p key="slash" className="d4-mono text-[14px] text-[var(--soft)]" exit={{ opacity: 0 }}>
                {frame >= 3 ? "/" : ""}
                {frame >= 3 ? <span className="d4-caret" /> : null}
              </motion.p>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {menu ? (
              <motion.ul
                className="absolute top-7 left-0 z-10 w-44 border border-[var(--line-2)] bg-[var(--bg)] py-1"
                initial={{ clipPath: "inset(0 0 100% 0)" }}
                animate={{ clipPath: "inset(0 0 0% 0)" }}
                exit={{ clipPath: "inset(0 0 100% 0)" }}
                transition={{ duration: 0.25, ease }}
              >
                {MENU.map((item, index) => {
                  const on = frame === 4 ? index === 3 : index === 0;
                  return (
                    <li key={item} className={cn("px-3 py-1 text-[12.5px]", on ? "bg-[var(--ink)] font-semibold text-[#0a0a0a]" : "text-[var(--soft)]")}>
                      {item}
                    </li>
                  );
                })}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </div>

        <motion.p
          className="mt-3 flex items-baseline gap-2 font-serif text-[17px] italic"
          initial={false}
          animate={{ x: math ? 0 : "-110%" }}
          transition={{ duration: 0.45, ease }}
        >
          <span>Σ cost<sub className="text-[11px]">i</sub> = 474</span>
          <span className="d4-mono text-[10px] not-italic text-[var(--faint)]">math</span>
        </motion.p>

        <motion.div
          className="mt-3 flex gap-2.5 border-l-4 px-3 py-2 text-[13px]"
          style={{ borderColor: C.amber.bg, background: "rgb(255 178 36 / 9%)" }}
          initial={false}
          animate={{ x: callout ? 0 : "-110%" }}
          transition={{ duration: 0.45, ease }}
        >
          Ship on a Tuesday, never on a Friday.
        </motion.div>
      </div>

      <AnimatePresence>
        {exported ? (
          <motion.p
            className="d4-mono absolute right-4 bottom-4 flex items-center gap-2 bg-[var(--ink)] px-3 py-2 text-[12px] font-semibold text-[#0a0a0a]"
            initial={{ y: 60 }}
            animate={{ y: 0 }}
            exit={{ y: 60 }}
            transition={{ duration: 0.4, ease }}
          >
            ↓ launch-brief.md
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---- Sheet: a SUM formula, the fill handle, a receipt photo becomes a row, CSV export ---- */

type Row = { item: string; category: string; cost: number; paid: boolean };

const BASE_ROWS: Row[] = [
  { item: "Domain", category: "Web", cost: 18, paid: true },
  { item: "Hosting", category: "Web", cost: 96, paid: true },
  { item: "Photos", category: "Content", cost: 120, paid: false },
  { item: "Prints", category: "", cost: 60, paid: false },
  { item: "Video", category: "", cost: 180, paid: false },
];
const RECEIPT: Row = { item: "Print shop", category: "Content", cost: 42.8, paid: true };
const FORMULA = "=SUM(C2:C7)";
const SHEET_MS = [1000, 600, 900, 1100, 900, 1100, 1500, 1300, 2800];

const CATEGORY_COLOR: Record<string, string> = { Web: C.cyan.bg, Content: C.pink.bg };

function money(value: number) {
  return `€${value.toFixed(value % 1 ? 2 : 0)}`;
}

export function SheetGraphic() {
  const { ref, frame } = useSteps(SHEET_MS);
  const typed = frame === 0 ? "" : frame === 1 ? FORMULA.slice(0, 5) : FORMULA;
  const computed = frame >= 3;
  const selecting = frame === 4 || frame === 5;
  const filled = frame >= 5;
  const receipt = frame === 6;
  const added = frame >= 7;
  const exported = frame >= 8;
  const rows = BASE_ROWS.map((row, index) => (filled && index >= 3 ? { ...row, category: "Content" } : row));
  const all = added ? [...rows, RECEIPT] : rows;
  const total = all.reduce((sum, row) => sum + row.cost, 0);
  const grid = "grid grid-cols-[28px_minmax(0,1.25fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_44px]";

  return (
    <div ref={ref} aria-hidden className="relative flex h-[440px] select-none flex-col overflow-hidden border border-[var(--line-2)] bg-[var(--panel)] sm:h-[460px]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line-2)] px-4 py-2.5">
        <span className="min-w-0 truncate text-[12px] text-[var(--soft)]">
          Website refresh <span className="text-[var(--faint)]">/</span> <span className="text-[var(--ink)]">Launch budget</span>
        </span>
        <span
          className="d4-mono inline-flex h-7 shrink-0 items-center px-2 text-[11px] font-semibold transition-colors duration-300"
          style={exported ? { background: C.green.bg, color: C.green.ink } : { border: "1px solid var(--line-2)", color: "var(--soft)" }}
        >
          Export CSV
        </span>
      </div>

      <div className="d4-mono flex h-8 items-center gap-3 border-b border-[var(--line)] px-3 text-[11.5px]">
        <span className="text-[var(--faint)]">{computed ? "C8" : "C8"}</span>
        <span className="text-[var(--amber)]">
          {frame >= 1 && !computed ? typed : computed ? FORMULA : ""}
          {!computed && frame >= 1 ? <span className="d4-caret" /> : null}
        </span>
      </div>

      <div className={cn(grid, "border-b border-[var(--line-2)] text-[10.5px] font-semibold text-[var(--soft)]")}>
        <span className="border-r border-[var(--line)] py-1.5" />
        <span className="border-r border-[var(--line)] px-2 py-1.5">
          <span className="d4-mono text-[var(--faint)]">Aa</span> Item
        </span>
        <span className="border-r border-[var(--line)] px-2 py-1.5">
          <span className="d4-mono text-[var(--faint)]">▾</span> Category
        </span>
        <span className="border-r border-[var(--line)] px-2 py-1.5 text-right">
          <span className="d4-mono text-[var(--faint)]">#</span> Cost
        </span>
        <span className="px-2 py-1.5 text-center">Paid</span>
      </div>

      <div className="relative">
        {all.map((row, index) => (
          <motion.div
            key={row.item}
            className={cn(grid, "h-[34px] items-center border-b border-[var(--line)] text-[12.5px]")}
            initial={index === 5 ? { x: "100%", backgroundColor: "rgba(0,144,255,0.25)" } : false}
            animate={{ x: 0, backgroundColor: "rgba(0,144,255,0)" }}
            transition={{ x: { duration: 0.5, ease }, backgroundColor: { duration: 1.6, delay: 0.4 } }}
          >
            <span className="d4-mono h-full border-r border-[var(--line)] pt-2 text-center text-[10px] text-[var(--faint)]">{index + 2}</span>
            <span className="truncate px-2 font-medium">{row.item}</span>
            <span className="relative h-full px-2">
              <AnimatePresence initial={false}>
                {row.category ? (
                  <motion.span
                    key={row.category}
                    className="absolute top-1/2 left-2 -translate-y-1/2 px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{ background: CATEGORY_COLOR[row.category], color: "#0a0a0a" }}
                    initial={{ scaleX: 0, originX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.3, delay: index >= 3 && index < 5 ? (index - 3) * 0.15 : 0, ease }}
                  >
                    {row.category}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </span>
            <span className="d4-mono truncate px-2 text-right">{money(row.cost)}</span>
            <span className="flex justify-center">
              <span
                className="flex size-3.5 items-center justify-center border text-[9px] leading-none font-bold"
                style={row.paid ? { background: C.green.bg, borderColor: C.green.bg, color: C.green.ink } : { borderColor: "var(--line-2)" }}
              >
                {row.paid ? "✓" : ""}
              </span>
            </span>
          </motion.div>
        ))}

        {/* fill handle: Photos' category dragged down over two rows */}
        {selecting ? (
          <motion.span
            className="pointer-events-none absolute border-2 border-[var(--amber)]"
            style={{ left: "calc(28px + (100% - 72px) * 1.25 / 3.15)", width: "calc((100% - 72px) * 1.1 / 3.15)", top: 2 * 34 }}
            initial={{ height: 34 }}
            animate={{ height: frame === 5 ? 34 * 3 : 34 }}
            transition={{ duration: 0.7, ease }}
          >
            <span className="absolute -right-[5px] -bottom-[5px] size-2 bg-[var(--amber)]" />
          </motion.span>
        ) : null}

        <div className={cn(grid, "h-[36px] items-center text-[12.5px] font-bold")}>
          <span className="d4-mono h-full border-r border-[var(--line)] pt-2.5 text-center text-[10px] font-normal text-[var(--faint)]">8</span>
          <span className="px-2">Total</span>
          <span />
          <span className="d4-mono relative truncate px-2 text-right">
            {computed ? (
              <motion.span key={total} className="inline-block" initial={{ y: -12 }} animate={{ y: 0 }} transition={{ duration: 0.3, ease }}>
                {money(total)}
              </motion.span>
            ) : (
              <span className="text-[var(--amber)]">{typed}</span>
            )}
          </span>
          <span />
        </div>
      </div>

      <div className="mt-auto flex border-t border-[var(--line-2)] text-[11.5px]">
        <span className="bg-[var(--ink)] px-3 py-2 font-semibold text-[#0a0a0a]">Budget</span>
        <span className="border-r border-[var(--line)] px-3 py-2 text-[var(--soft)]">Receipts</span>
        <span className="px-3 py-2 text-[var(--faint)]">+</span>
      </div>

      <AnimatePresence>
        {receipt ? (
          <motion.div
            className="absolute inset-x-3 bottom-12 border border-[var(--line-2)] bg-[var(--bg)] p-3 sm:inset-x-4"
            initial={{ y: 120 }}
            animate={{ y: 0 }}
            exit={{ y: 140 }}
            transition={{ duration: 0.45, ease }}
          >
            <p className="d4-label text-[10px] text-[var(--amber)]">Receipt read by the assistant</p>
            <p className="mt-1.5 flex items-center gap-3 text-[13px]">
              <span className="d4-mono truncate text-[var(--soft)]">IMG_2041.jpg</span>
              <span className="truncate font-semibold">Print shop · €42.80 · today</span>
              <span className="ml-auto bg-[var(--ink)] px-2.5 py-1 text-[11.5px] font-semibold text-[#0a0a0a]">Add</span>
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {exported ? (
          <motion.p
            className="d4-mono absolute right-4 bottom-12 bg-[var(--ink)] px-3 py-2 text-[12px] font-semibold text-[#0a0a0a]"
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            transition={{ duration: 0.4, ease }}
          >
            ↓ launch-budget.csv
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
