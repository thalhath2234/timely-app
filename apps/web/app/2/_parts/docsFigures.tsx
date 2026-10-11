"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { useLoop } from "./hooks";

const spring = { type: "spring", stiffness: 300, damping: 28 } as const;
const MENU = ["Heading", "To-do list", "Table", "Diagram", "Math", "Callout"];
const NODES = ["Brief", "Build", "Launch"];

/** The doc page: Markdown turns into blocks, a slash command adds a diagram, then .md export. */
export function DocPage() {
  const { ref, frame } = useLoop(8, [1300, 900, 800, 1000, 1200, 1200, 1300, 2600], 7);
  const heading = frame >= 1;
  const slash = frame === 1 || frame === 2;
  const menu = frame === 2;
  const diagram = frame >= 3;
  const exported = frame >= 6;
  return (
    <div
      ref={ref}
      role="img"
      aria-label="A doc called Launch plan. Typing two hashes makes a heading; the slash menu adds a Mermaid diagram from Brief to Build to Launch, a maths line and a callout; then the doc exports as launch-plan.md."
      className="relative flex h-full flex-col p-5 sm:p-7"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="d2-mono text-[10px] tracking-widest text-[var(--ink-3)] uppercase">Website launch · Doc</p>
          <p className="d2-serif mt-1 text-[1.75rem] leading-tight">Launch plan</p>
        </div>
        <motion.span
          initial={false}
          animate={frame === 6 ? { scale: [1, 0.9, 1] } : { scale: 1 }}
          transition={{ duration: 0.3 }}
          className={cn(
            "d2-mono shrink-0 border px-2 py-1 text-[10.5px] transition-colors",
            exported ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--rule-3)] text-[var(--ink-2)]",
          )}
        >
          ↓ .md
        </motion.span>
      </div>
      <p className="d2-serif mt-3 text-[14px] leading-relaxed text-[var(--ink-2)]">
        We ship the new site on Tuesday 27 October. Everything below is the plan.
      </p>

      <div className="mt-4 h-7">
        {heading ? (
          <p className="d2-serif text-[1.2rem] font-medium">Timeline</p>
        ) : (
          <p className="d2-mono text-[13px] text-[var(--ink)]">
            <span className="text-[var(--verm-2)]">## </span>Timeline
            <span className="d2-caret" />
          </p>
        )}
      </div>

      <div className="relative mt-2 min-h-[92px]">
        <AnimatePresence mode="wait" initial={false}>
          {diagram ? (
            <motion.div key="diagram" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border border-dashed border-[var(--rule-2)] px-3 pt-2 pb-3">
              <p className="d2-mono text-[9.5px] text-[var(--ink-3)]">mermaid · flowchart LR</p>
              <div className="mt-2 flex items-center">
                {NODES.map((node, index) => (
                  <div key={node} className="flex flex-1 items-center">
                    <motion.span
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...spring, delay: index * 0.2 }}
                      className={cn(
                        "flex-1 border py-1.5 text-center text-[12px]",
                        index === 2 ? "border-[var(--verm)] text-[var(--verm-2)]" : "border-[var(--ink-2)]",
                      )}
                    >
                      {node}
                    </motion.span>
                    {index < NODES.length - 1 ? (
                      <svg viewBox="0 0 26 10" className="w-6 shrink-0 text-[var(--ink-2)]" aria-hidden>
                        <motion.path
                          d="M1 5 H23 M18.5 1.5 L23 5 L18.5 8.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.4, delay: 0.15 + index * 0.2 }}
                        />
                      </svg>
                    ) : null}
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.p key="slash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="d2-mono text-[13px]">
              {slash ? "/" : ""}
              <span className="d2-caret" />
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {menu ? (
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="absolute top-6 left-0 z-10 w-44 border border-[var(--rule-3)] bg-[var(--paper)] py-1 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.9)]"
            >
              {MENU.map((item, index) => (
                <li
                  key={item}
                  className={cn(
                    "flex items-center justify-between px-2.5 py-[3px] text-[12px]",
                    index === 3 ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-2)]",
                  )}
                >
                  {item}
                  {index === 3 ? <span className="d2-mono text-[9px]">↵</span> : null}
                </li>
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>

      <motion.p
        initial={false}
        animate={{ opacity: frame >= 4 ? 1 : 0.08 }}
        className="d2-serif mt-4 text-center text-[1.15rem] italic"
      >
        budget = <span className="not-italic">Σ</span> cost<sub className="text-[0.7em]">i</sub> = €474
      </motion.p>
      <motion.p
        initial={false}
        animate={{ opacity: frame >= 5 ? 1 : 0.08, x: frame >= 5 ? 0 : -6 }}
        transition={spring}
        className="mt-4 border-l-2 border-[var(--verm)] bg-[var(--verm-wash)] px-3 py-2 text-[13px]"
      >
        <span className="d2-mono mr-1.5 text-[10px] text-[var(--verm-2)] uppercase">Note</span>
        Ship on a Tuesday, never on a Friday.
      </motion.p>

      <AnimatePresence>
        {exported ? (
          <motion.div
            initial={{ y: 40, opacity: 0, rotate: 0 }}
            animate={{ y: 0, opacity: 1, rotate: -3 }}
            exit={{ opacity: 0 }}
            transition={spring}
            className="d2-mono absolute right-4 bottom-4 border border-[var(--rule-3)] bg-[var(--ink)] px-3 py-2 text-[11px] text-[var(--paper)] shadow-[0_14px_30px_-10px_rgb(0_0_0/0.9)] sm:right-6"
          >
            launch-plan.md
            <span className="block text-[9.5px] opacity-60"># Launch plan · 1.2 KB</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const ROWS = [
  { item: "Domain", category: "Web", cost: 18, paid: true },
  { item: "Hosting", category: "Web", cost: 96, paid: true },
  { item: "Photos", category: "Content", cost: 120, paid: false },
  { item: "Fonts", category: "Design", cost: 240, paid: false },
];
const RECEIPT = { item: "Print shop", category: "Content", cost: 42.8, paid: true };
const FORMULA = "=SUM(C2:C6)";
const money = (value: number) => `€${value.toFixed(value % 1 ? 2 : 0)}`;
const COLS = "grid grid-cols-[1.4fr_1.15fr_0.9fr_0.55fr]";

/** The sheet page: a SUM, a receipt read into a new row, then CSV export. */
export function SheetPage() {
  const { ref, frame } = useLoop(8, [1200, 700, 900, 1300, 1500, 1400, 1300, 2600], 7);
  const typed = frame === 1 ? FORMULA.slice(0, 5) : FORMULA;
  const computed = frame >= 3;
  const receipt = frame === 4;
  const added = frame >= 5;
  const exported = frame >= 6;
  const rows = added ? [...ROWS, RECEIPT] : ROWS;
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  return (
    <div
      ref={ref}
      role="img"
      aria-label="A sheet called Launch budget with typed columns Item, Category, Cost and Paid. A SUM formula totals €474; a photo of a receipt from a print shop adds a row for €42.80, the total becomes €516.80, and the sheet exports as launch-budget.csv."
      className="relative flex h-full flex-col p-5 sm:p-7"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="d2-mono text-[10px] tracking-widest text-[var(--ink-3)] uppercase">Website launch · Sheet</p>
          <p className="d2-serif mt-1 text-[1.75rem] leading-tight">Launch budget</p>
        </div>
        <motion.span
          initial={false}
          animate={frame === 6 ? { scale: [1, 0.9, 1] } : { scale: 1 }}
          transition={{ duration: 0.3 }}
          className={cn(
            "d2-mono shrink-0 border px-2 py-1 text-[10.5px] transition-colors",
            exported ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--rule-3)] text-[var(--ink-2)]",
          )}
        >
          ↓ CSV
        </motion.span>
      </div>

      <div className="mt-4 border-t border-[var(--rule-3)] text-[12.5px]">
        <div className={cn(COLS, "border-b border-[var(--rule-2)] py-1.5 text-[11px] text-[var(--ink-3)]")}>
          <span>
            Item <span className="d2-mono text-[9px]">Aa</span>
          </span>
          <span>
            Category <span className="d2-mono text-[9px]">▾</span>
          </span>
          <span className="text-right">
            Cost <span className="d2-mono text-[9px]">€</span>
          </span>
          <span className="text-right">Paid</span>
        </div>
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.div
              key={row.item}
              initial={{ opacity: 0, height: 0, backgroundColor: "rgba(240,92,59,0.25)" }}
              animate={{ opacity: 1, height: "auto", backgroundColor: "rgba(240,92,59,0)" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ ...spring, backgroundColor: { duration: 1.8 } }}
              className="overflow-hidden"
            >
              <div className={cn(COLS, "items-center border-b border-dotted border-[var(--rule-2)] py-[6px]")}>
                <span className="truncate">{row.item}</span>
                <span className="text-[var(--ink-2)]">
                  <span className="border-b border-dotted border-[var(--rule-3)]">{row.category}</span>
                </span>
                <span
                  className={cn(
                    "d2-mono text-right text-[12px] transition-colors",
                    frame === 2 && "bg-[var(--verm-wash)] outline outline-1 outline-[var(--verm)]/60",
                  )}
                >
                  {money(row.cost)}
                </span>
                <span className="flex justify-end">
                  <span className={cn("flex size-3.5 items-center justify-center border text-[9px] leading-none", row.paid ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--rule-3)]")}>
                    {row.paid ? "✓" : ""}
                  </span>
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div className={cn(COLS, "items-center border-t border-[var(--rule-3)] py-2 font-medium")}>
          <span className="d2-serif italic">Total</span>
          <span />
          <span className="relative text-right">
            <span className="d2-mono text-[12px]">
              {computed ? (
                <motion.span key={total} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="inline-block">
                  {money(total)}
                </motion.span>
              ) : frame === 0 ? (
                <span className="d2-caret" />
              ) : (
                <span className="text-[var(--verm-2)]">
                  {typed}
                  <span className="d2-caret" />
                </span>
              )}
            </span>
            {computed ? <span aria-hidden className="absolute -right-[3px] -bottom-[3px] size-[6px] bg-[var(--verm)]" /> : null}
          </span>
          <span />
        </div>
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 pt-4">
        <div className="d2-mono flex text-[10.5px]">
          <span className="border border-t-0 border-[var(--rule-3)] bg-[var(--paper)] px-2.5 py-1">Budget</span>
          <span className="border-b border-[var(--rule-2)] px-2.5 py-1 text-[var(--ink-3)]">Vendors</span>
          <span className="border-b border-[var(--rule-2)] px-2 py-1 text-[var(--ink-3)]">+</span>
        </div>
        <p className="d2-mono text-[10px] text-[var(--ink-3)]">{added ? "row added from a receipt" : "4 rows"}</p>
      </div>

      <AnimatePresence>
        {receipt ? (
          <motion.div
            initial={{ x: 60, opacity: 0, rotate: 6 }}
            animate={{ x: 0, opacity: 1, rotate: 4 }}
            exit={{ x: -30, y: 30, opacity: 0, rotate: 0, scale: 0.9 }}
            transition={spring}
            className="d2-mono absolute top-12 right-5 w-[150px] bg-[#e9e1cf] px-3 pt-3 pb-4 text-[10px] leading-snug text-[#2a241c] shadow-[0_20px_40px_-12px_rgb(0_0_0/0.9)] [clip-path:polygon(0_0,100%_0,100%_96%,92%_100%,84%_96%,76%_100%,68%_96%,60%_100%,52%_96%,44%_100%,36%_96%,28%_100%,20%_96%,12%_100%,4%_96%,0_100%)]"
          >
            <p className="text-center font-medium tracking-widest">PRINT SHOP</p>
            <p className="mt-1 text-center">11.10.2026 · 14:12</p>
            <p className="mt-2 flex justify-between border-t border-dashed border-[#2a241c]/40 pt-1">
              <span>2× A2 poster</span>
              <span>42.80</span>
            </p>
            <p className="mt-1 flex justify-between font-medium">
              <span>TOTAL EUR</span>
              <span>42.80</span>
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {exported ? (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1, rotate: 2.5 }}
            exit={{ opacity: 0 }}
            transition={spring}
            className="d2-mono absolute right-4 bottom-12 border border-[var(--rule-3)] bg-[var(--ink)] px-3 py-2 text-[11px] text-[var(--paper)] shadow-[0_14px_30px_-10px_rgb(0_0_0/0.9)] sm:right-6"
          >
            launch-budget.csv
            <span className="block text-[9.5px] opacity-60">Item,Category,Cost,Paid</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
