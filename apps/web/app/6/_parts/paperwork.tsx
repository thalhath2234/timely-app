"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, CheckSquare, Download, GitBranch, Heading2, Lightbulb, Sigma, Table2, type LucideIcon } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { NOTE, Tape } from "./paper";
import { drop, settle, useLoop } from "./motionKit";

/* ---- The doc: a slash command becomes a diagram, then it exports as Markdown ---- */

const MENU: { icon: LucideIcon; label: string }[] = [
  { icon: Heading2, label: "Heading" },
  { icon: CheckSquare, label: "To-do list" },
  { icon: Table2, label: "Table" },
  { icon: GitBranch, label: "Diagram" },
  { icon: Sigma, label: "Math" },
  { icon: Lightbulb, label: "Callout" },
];

const NODES = ["Brief", "Build", "Launch"];

function DocPaper() {
  const { ref, frame } = useLoop(5, [1300, 900, 1000, 2600, 2600], 4);
  const menu = frame === 1 || frame === 2;
  const diagram = frame >= 3;
  return (
    <div ref={ref} aria-hidden className="relative">
      <div className="d6-paper relative min-h-[420px] overflow-hidden px-6 pt-6 pb-8 sm:rotate-[-1.2deg] sm:px-8">
        <Tape className="-top-2 left-8 rotate-[-6deg]" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="d6-mono text-[0.7rem] font-semibold text-[var(--paper-soft)]">Website launch / Docs</p>
            <p className="d6-display mt-1 text-[1.9rem] leading-none font-extrabold">Launch plan</p>
          </div>
          <motion.span
            animate={frame === 4 ? { scale: [1, 0.9, 1] } : { scale: 1 }}
            transition={{ duration: 0.3 }}
            className={cn(
              "d6-mono flex items-center gap-1 rounded-md border-[1.5px] px-2 py-1 text-[0.72rem] font-bold transition-colors",
              frame === 4 ? "border-[var(--paper-ink)] bg-[var(--paper-ink)] text-[var(--n-cream)]" : "border-black/25",
            )}
          >
            <Download className="size-3.5" />
            .md
          </motion.span>
        </div>

        <p className="mt-5 text-[0.95rem] leading-relaxed">
          <span className="font-bold">## Goals</span> Ship the new site by the <span className="underline decoration-[var(--n-violet)] decoration-2">30th</span>, with
          the brief signed off first.
        </p>

        <div className="relative mt-4 min-h-[112px]">
          <AnimatePresence mode="wait" initial={false}>
            {diagram ? (
              <motion.div
                key="diagram"
                initial={{ y: 6 }}
                animate={{ y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-md border-[1.5px] border-dashed border-black/20 p-3"
              >
                <p className="d6-mono flex items-center gap-1 text-[0.68rem] font-semibold text-[var(--paper-soft)]">
                  <GitBranch className="size-3" /> mermaid
                </p>
                <div className="mt-2 flex items-center gap-1">
                  {NODES.map((node, index) => (
                    <div key={node} className="flex flex-1 items-center gap-1">
                      <motion.span
                        initial={{ scale: 0.6, rotate: -6 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ ...drop, delay: index * 0.18 }}
                        className="flex-1 rounded-[4px] py-2 text-center text-[0.8rem] font-bold shadow-[0_2px_3px_rgb(0_0_0/0.2)]"
                        style={{ background: [NOTE.violet, NOTE.yellow, NOTE.green][index] }}
                      >
                        {node}
                      </motion.span>
                      {index < NODES.length - 1 ? (
                        <svg viewBox="0 0 24 10" className="w-5 shrink-0">
                          <motion.path
                            d="M1 5 H21 M16 1 L21 5 L16 9"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.35, delay: 0.2 + index * 0.18 }}
                          />
                        </svg>
                      ) : null}
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.p key="slash" exit={{ opacity: 0 }} className="text-[0.95rem]">
                {frame >= 1 ? "/dia" : ""}
                <span className="d6-caret ml-px inline-block h-4 w-[2px] translate-y-0.5 bg-[var(--paper-ink)]" />
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {menu ? (
              <motion.ul
                key="menu"
                initial={{ y: -4, scale: 0.96, opacity: 0 }}
                animate={{ y: 0, scale: 1, opacity: 1 }}
                exit={{ y: -4, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute top-7 left-0 z-10 w-44 rounded-lg bg-[var(--paper-ink)] p-1 text-[var(--n-cream)] shadow-xl"
              >
                {MENU.map((item, index) => (
                  <li
                    key={item.label}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 text-[0.78rem]",
                      frame === 2 && index === 3 ? "bg-[var(--n-yellow)] font-bold text-[var(--paper-ink)]" : "text-white/75",
                    )}
                  >
                    <item.icon className="size-3.5" />
                    {item.label}
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </div>

        <p className="mt-4 text-center font-serif text-[1.05rem] italic">
          budget = <span className="not-italic">Σ</span> cost<sub>i</sub> ≤ €600
        </p>

        <div
          className="mt-4 flex gap-2 rounded-md border-l-4 border-[#d9a300] bg-[#ffd65c]/40 px-3 py-2 text-[0.88rem] font-medium"
        >
          <Lightbulb className="mt-0.5 size-4 shrink-0" />
          Ship on a Tuesday, never on a Friday.
        </div>

        <AnimatePresence>
          {frame === 4 ? (
            <motion.p
              key="export"
              initial={{ y: 16, rotate: 4 }}
              animate={{ y: 0, rotate: -2 }}
              exit={{ y: 10, opacity: 0 }}
              transition={drop}
              className="d6-mono absolute right-5 bottom-3 flex items-center gap-1.5 rounded-md bg-[var(--paper-ink)] px-3 py-1.5 text-[0.75rem] font-semibold text-[var(--n-cream)] shadow-lg"
            >
              <Check className="size-3.5 text-[var(--n-green)]" />
              launch-plan.md saved
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---- The sheet: a formula, then a receipt photo becomes a row ---- */

const ROWS = [
  { item: "Domain", category: "Web", color: NOTE.blue, cost: 18, paid: true },
  { item: "Hosting", category: "Web", color: NOTE.blue, cost: 96, paid: true },
  { item: "Photos", category: "Content", color: NOTE.pink, cost: 120, paid: false },
  { item: "Fonts", category: "Design", color: NOTE.yellow, cost: 240, paid: false },
];
const RECEIPT_ROW = { item: "Print shop", category: "Content", color: NOTE.pink, cost: 42.8, paid: true };

function euro(value: number) {
  return `€${value.toFixed(value % 1 ? 2 : 0)}`;
}

function SheetPaper() {
  const { ref, frame } = useLoop(6, [1300, 1300, 1500, 1200, 2600, 400], 4);
  const computed = frame >= 1 && frame !== 5;
  const receipt = frame >= 2 && frame <= 4;
  const added = frame >= 3 && frame <= 4;
  const rows = added ? [...ROWS, RECEIPT_ROW] : ROWS;
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  return (
    <div ref={ref} aria-hidden className="relative">
      <div
        className="d6-paper relative min-h-[420px] overflow-hidden pt-5 pb-14 sm:rotate-[1deg]"
        style={{
          backgroundColor: "#f1f3ea",
          backgroundImage:
            "linear-gradient(rgb(48 166 109 / 13%) 1px, transparent 1px), linear-gradient(90deg, rgb(48 166 109 / 13%) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <Tape className="-top-2 right-10 rotate-[5deg]" />
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6">
          <div>
            <p className="d6-mono text-[0.7rem] font-semibold text-[var(--paper-soft)]">Website launch / Sheets</p>
            <p className="d6-display mt-1 text-[1.9rem] leading-none font-extrabold">Launch budget</p>
          </div>
          <span className="d6-mono rounded-md border-[1.5px] border-black/25 px-2 py-1 text-[0.72rem] font-bold">CSV</span>
        </div>

        <div className="mt-5 px-3 text-[0.82rem] sm:px-4">
          <div className="grid grid-cols-[1.25fr_1.1fr_0.8fr_0.45fr] gap-x-2 border-b-2 border-[var(--paper-ink)] px-2 pb-1.5 text-[0.7rem] font-bold">
            <span>Item <span className="d6-mono font-medium text-[var(--paper-soft)]">Aa</span></span>
            <span>Category <span className="d6-mono font-medium text-[var(--paper-soft)]">▾</span></span>
            <span className="text-right">Cost <span className="d6-mono font-medium text-[var(--paper-soft)]">€</span></span>
            <span className="text-right">Paid</span>
          </div>
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.div
                key={row.item}
                initial={{ height: 0, backgroundColor: "rgba(255,214,92,0.9)" }}
                animate={{ height: "auto", backgroundColor: "rgba(255,214,92,0)" }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ ...settle, backgroundColor: { duration: 1.8 } }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-[1.25fr_1.1fr_0.8fr_0.45fr] items-center gap-x-2 border-b border-black/10 px-2 py-[7px]">
                  <span className="truncate font-medium">{row.item}</span>
                  <span>
                    <span className="rounded-full px-2 py-px text-[0.7rem] font-bold" style={{ background: row.color }}>
                      {row.category}
                    </span>
                  </span>
                  <span className="d6-mono text-right">{euro(row.cost)}</span>
                  <span className="flex justify-end">
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[3px] border-[1.5px] border-[var(--paper-ink)]",
                        row.paid && "bg-[var(--paper-ink)] text-[#f1f3ea]",
                      )}
                    >
                      {row.paid ? <Check className="size-3" strokeWidth={3.5} /> : null}
                    </span>
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div className="grid grid-cols-[1.25fr_1.1fr_0.8fr_0.45fr] items-center gap-x-2 px-2 py-2 font-bold">
            <span>Total</span>
            <span />
            <span className="d6-mono text-right">
              {computed ? (
                <motion.span key={total} initial={{ y: -6 }} animate={{ y: 0 }} className="inline-block rounded bg-[var(--n-yellow)] px-1">
                  {euro(total)}
                </motion.span>
              ) : (
                <span className="rounded px-1 outline-2 outline-[var(--n-violet)]">=SUM(C2:C6)</span>
              )}
            </span>
            <span />
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 border-t border-black/15 px-4 pt-0">
          {["Budget", "Vendors", "Receipts"].map((tab, index) => (
            <span
              key={tab}
              className={cn(
                "rounded-b-md px-3 py-1.5 text-[0.75rem] font-bold",
                index === 0 ? "bg-[var(--paper-ink)] text-[#f1f3ea]" : "text-[var(--paper-soft)]",
              )}
            >
              {tab}
            </span>
          ))}
          <span className="px-2 py-1.5 text-[0.85rem] font-bold text-[var(--paper-soft)]">+</span>
        </div>
      </div>

      <AnimatePresence>
        {receipt ? (
          <motion.div
            key="receipt"
            initial={{ x: 60, y: 30, rotate: 18 }}
            animate={{ x: 0, y: 0, rotate: 7 }}
            exit={{ x: 40, opacity: 0 }}
            transition={drop}
            className="d6-receipt d6-mono absolute -right-1 bottom-12 w-[150px] px-3 pt-3 pb-5 text-[0.68rem] shadow-none sm:-right-6"
          >
            <p className="text-center font-bold tracking-widest">PRINT SHOP</p>
            <p className="mt-1 text-center text-black/55">Fri 16 Oct 2026</p>
            <p className="mt-2 flex justify-between"><span>Flyers A5</span><span>38.00</span></p>
            <p className="flex justify-between"><span>Poster</span><span>4.80</span></p>
            <p className="mt-1 flex justify-between border-t border-dashed border-black/30 pt-1 font-bold"><span>TOTAL</span><span>€42.80</span></p>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {added ? (
          <motion.p
            key="said"
            initial={{ y: 10, scale: 0.95 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={drop}
            className="absolute -bottom-4 left-4 rounded-lg bg-[var(--paper-ink)] px-3 py-1.5 text-[0.75rem] font-semibold text-[var(--n-cream)] shadow-lg"
          >
            Assistant: added “Print shop, €42.80” from your photo
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const DOC_POINTS = [
  "A block editor that speaks Markdown, in and out",
  "Slash menu for headings, to-dos, tables and more",
  "Mermaid diagrams and maths",
  "Callouts, then export as .md",
];
const SHEET_POINTS = [
  "Typed columns and formulas",
  "Dropdowns and checkboxes",
  "Fill handle and tabs",
  "Export as CSV",
];

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[var(--soft)]">
          <span className="mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-[4px] bg-[var(--n-green)] text-[var(--paper-ink)]">
            <Check className="size-3" strokeWidth={3.5} />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function Paperwork() {
  return (
    <div className="mt-14 grid gap-16 lg:grid-cols-2 lg:gap-12">
      <article>
        <DocPaper />
        <h3 className="d6-display mt-10 text-[1.6rem] font-extrabold">Docs</h3>
        <p className="d6-soft mt-2 leading-relaxed">
          Briefs, meeting notes and plans, written where the work is. Ask the assistant to draft one and edit it like any
          other page.
        </p>
        <Points items={DOC_POINTS} />
      </article>
      <article>
        <SheetPaper />
        <h3 className="d6-display mt-10 text-[1.6rem] font-extrabold">Sheets</h3>
        <p className="d6-soft mt-2 leading-relaxed">
          Budgets, reading lists and trackers. Snap a receipt and the assistant adds the row to your expense sheet.
        </p>
        <Points items={SHEET_POINTS} />
      </article>
    </div>
  );
}
