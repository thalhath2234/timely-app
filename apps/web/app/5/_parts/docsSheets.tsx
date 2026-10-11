"use client";

import { Fragment } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Camera,
  CheckSquare,
  ChevronDown,
  Download,
  FileText,
  GitBranch,
  Heading2,
  Lightbulb,
  ListChecks,
  Search,
  Sigma,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/app/utils/cn";
import { useFrames } from "./shell";

const ease = [0.22, 1, 0.36, 1] as const;

/* ---- The doc: Markdown shortcuts, the slash menu, a Mermaid diagram, math, a callout, export ---- */

const MENU: { icon: LucideIcon; label: string }[] = [
  { icon: Heading2, label: "Heading" },
  { icon: CheckSquare, label: "To-do list" },
  { icon: Lightbulb, label: "Callout" },
  { icon: Table2, label: "Table" },
  { icon: GitBranch, label: "Mermaid diagram" },
  { icon: Sigma, label: "Math" },
];
const NODES = [
  { x: 6, label: "Brief" },
  { x: 38, label: "Design" },
  { x: 70, label: "Ship" },
];
const DOC_MS = [1200, 1300, 1000, 900, 1100, 1800, 1400, 2600] as const;

function DocGraphic() {
  const { ref, frame } = useFrames(8, DOC_MS, 7);
  const heading = frame >= 2;
  const slash = frame === 3 || frame === 4;
  const menu = slash;
  const pick = frame === 4 ? 4 : 0;
  const diagram = frame >= 5;
  const exported = frame === 7;
  return (
    <div ref={ref} className="doc" aria-hidden>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate text-[var(--faint)]">Website refresh / Launch brief</span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 transition-colors duration-500",
            exported ? "border-[rgb(168_224_195/45%)] text-[var(--mint)]" : "border-[var(--line-2)] text-[var(--soft)]",
          )}
        >
          <Download className="size-3.5" />
          Export .md
        </span>
      </div>
      <p className="mt-5 text-[26px] leading-tight font-semibold tracking-[-0.02em]">Launch brief</p>
      <p className="mt-2 text-[15px] text-[var(--soft)]">
        The new homepage goes live on Fri 23 Oct. Copy is frozen a week before.
      </p>
      <p className="mt-3 flex gap-2.5 rounded-xl border border-[rgb(230_201_158/30%)] bg-[rgb(230_201_158/7%)] px-3.5 py-2.5 text-[14px]">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-[var(--sand)]" />
        The printer needs final files by Wed 12:00.
      </p>
      <p className="mt-3 font-[family-name:var(--serif)] text-[19px] italic">
        budget = 18 + 96 + 120 + 240 = <span className="not-italic">€474</span>
      </p>

      <div className="relative mt-4">
        <div className="h-8">
          <AnimatePresence mode="wait" initial={false}>
            {heading ? (
              <motion.p
                key="h"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="text-[20px] font-semibold"
              >
                Timeline
              </motion.p>
            ) : (
              <motion.p key="md" exit={{ opacity: 0 }} className="pt-1 font-mono text-[15px] text-[var(--mint)]">
                {frame === 1 ? "## Timeline" : ""}
                <span className="caret" />
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <div className="relative mt-2 h-[92px]">
          {slash ? (
            <p className="text-[14px]">
              /<span className="caret" />
            </p>
          ) : null}
          <motion.div
            initial={false}
            animate={{ opacity: diagram ? 1 : 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 rounded-xl border border-[var(--line)] bg-[rgb(190_225_205/2%)]"
          >
            <span className="absolute top-2 left-3 text-[11.5px] text-[var(--faint)]">mermaid</span>
            <svg
              viewBox="0 5 100 20"
              className="absolute inset-x-3 top-6 bottom-2 h-[56px] w-[calc(100%-24px)]"
              preserveAspectRatio="xMidYMid meet"
            >
              {NODES.map((node, i) => (
                <g key={node.label}>
                  <motion.rect
                    x={node.x}
                    y={7}
                    width={24}
                    height={16}
                    rx={4}
                    fill="rgb(168 224 195 / 10%)"
                    stroke="rgb(168 224 195 / 55%)"
                    strokeWidth={0.5}
                    initial={false}
                    animate={{
                      opacity: diagram ? 1 : 0,
                      scale: diagram ? 1 : 0.85,
                    }}
                    transition={{
                      duration: 0.5,
                      delay: diagram ? i * 0.25 : 0,
                      ease,
                    }}
                    style={{ transformOrigin: `${node.x + 12}px 15px` }}
                  />
                  <motion.text
                    x={node.x + 12}
                    y={16.6}
                    textAnchor="middle"
                    fontSize={5}
                    fill="#e4ede7"
                    initial={false}
                    animate={{ opacity: diagram ? 1 : 0 }}
                    transition={{
                      duration: 0.4,
                      delay: diagram ? i * 0.25 + 0.1 : 0,
                    }}
                  >
                    {node.label}
                  </motion.text>
                  {i < NODES.length - 1 ? (
                    <motion.path
                      d={`M${node.x + 25} 15 H${node.x + 31} M${node.x + 29} 13 L${node.x + 31} 15 L${node.x + 29} 17`}
                      fill="none"
                      stroke="rgb(190 225 205 / 55%)"
                      strokeWidth={0.6}
                      initial={false}
                      animate={{ pathLength: diagram ? 1 : 0 }}
                      transition={{
                        duration: 0.4,
                        delay: diagram ? i * 0.25 + 0.3 : 0,
                      }}
                    />
                  ) : null}
                </g>
              ))}
            </svg>
          </motion.div>
          <AnimatePresence>
            {menu ? (
              <motion.ul
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="absolute top-6 left-0 z-10 w-52 rounded-xl border border-[var(--line-2)] bg-[var(--panel-2)] p-1.5 shadow-[0_24px_48px_-12px_rgb(0_0_0/60%)]"
              >
                {MENU.map((item, i) => (
                  <li
                    key={item.label}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors duration-300",
                      i === pick ? "bg-[rgb(168_224_195/12%)] text-[var(--ink)]" : "text-[var(--soft)]",
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
      </div>

      <AnimatePresence>
        {exported ? (
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease }}
            className="absolute right-5 bottom-5 flex items-center gap-2 rounded-full border border-[var(--line-2)] bg-[var(--panel-2)] px-3.5 py-2 text-[13px] shadow-[0_16px_32px_-12px_rgb(0_0_0/60%)]"
          >
            <FileText className="size-3.5 text-[var(--mint)]" />
            launch-brief.md
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---- The sheet: typed columns, a formula, the fill handle, a receipt photo, CSV ---- */

const ROWS = [
  { item: "Domain", cat: "Web", color: "var(--blue)", cost: 18, paid: true },
  { item: "Hosting", cat: "Web", color: "var(--blue)", cost: 96, paid: true },
  {
    item: "Photos",
    cat: "Content",
    color: "var(--rose)",
    cost: 120,
    paid: false,
  },
  {
    item: "Fonts",
    cat: "Design",
    color: "var(--amber)",
    cost: 240,
    paid: false,
  },
];
const RECEIPT = {
  item: "Print shop",
  cat: "Content",
  color: "var(--rose)",
  cost: 42.8,
  paid: true,
};
const SHEET_MS = [1200, 1500, 1500, 1500, 1800, 1800, 2600] as const;

function eur(value: number) {
  return `€${value % 1 ? value.toFixed(2) : value}`;
}

function SheetGraphic() {
  const { ref, frame } = useFrames(7, SHEET_MS, 5);
  const formula = frame >= 1;
  const filling = frame === 2;
  const filled = frame >= 3;
  const photo = frame === 4;
  const added = frame >= 5;
  const exported = frame === 6;
  const rows = added ? [...ROWS, RECEIPT] : ROWS;
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  const cell = filling ? "E3" : formula && !added ? "D6" : added ? "A6" : "B2";
  const bar = filling ? "TRUE" : formula && !added ? "=SUM(D2:D5)" : added ? "Print shop" : "Domain";

  return (
    <div ref={ref} className="sheet" aria-hidden>
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <span className="text-[16px] font-semibold">Launch budget</span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors duration-500",
            exported ? "border-[rgb(168_224_195/45%)] text-[var(--mint)]" : "border-[var(--line-2)] text-[var(--soft)]",
          )}
        >
          <Download className="size-3.5" />
          Export CSV
        </span>
      </div>
      <div className="flex items-center gap-0 border-y border-[var(--line)] font-mono text-[13px]">
        <span className="w-12 shrink-0 border-r border-[var(--line)] py-2 text-center text-[var(--faint)]">{cell}</span>
        <span className="min-w-0 truncate px-3 py-2 text-[var(--mint)]">{bar}</span>
      </div>
      <div className="sheet-grid">
        <span className="rn" />
        <span className="hd">
          <span className="text-[var(--faint)]">Aa</span> Item
        </span>
        <span className="hd">
          <ChevronDown className="size-3 text-[var(--faint)]" /> Category
        </span>
        <span className="hd r">
          <span className="text-[var(--faint)]">€</span> Amount
        </span>
        <span className="hd justify-center">
          <ListChecks className="size-3.5 text-[var(--faint)]" />
        </span>
        {rows.map((row, i) => {
          const isNew = row === RECEIPT;
          const paid = row.paid || (filled && i === 2) || (filled && i === 3);
          const inFill = filling && (i === 2 || i === 3);
          return (
            <Fragment key={row.item}>
              <span className={cn("rn num", isNew && "row-in")}>{i + 2}</span>
              <span className={cn(isNew && "row-in")}>{row.item}</span>
              <span className={cn(isNew && "row-in")}>
                <span
                  className="tag"
                  style={{
                    color: row.color,
                    background: `color-mix(in oklch, ${row.color} 14%, transparent)`,
                  }}
                >
                  {row.cat}
                </span>
              </span>
              <span
                className={cn(
                  "r num transition-colors duration-500",
                  formula && !added && !filling && !filled && "bg-[rgb(168_224_195/8%)]",
                  isNew && "row-in",
                )}
              >
                {eur(row.cost)}
              </span>
              <span
                className={cn(
                  "relative justify-center transition-colors duration-300",
                  inFill &&
                    "bg-[rgb(168_224_195/10%)] outline outline-1 -outline-offset-1 outline-dashed outline-[var(--mint)]",
                  filling && i === 1 && "outline outline-2 -outline-offset-2 outline-[var(--mint)]",
                  isNew && "row-in",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-[4px] border transition-colors duration-500",
                    paid ? "border-[var(--mint)] bg-[var(--mint)] text-[var(--mint-ink)]" : "border-[var(--line-3)]",
                  )}
                >
                  {paid ? <span className="text-[10px] leading-none font-bold">✓</span> : null}
                </span>
                {filling && i === 1 ? (
                  <span className="absolute right-0.5 bottom-0.5 size-1.5 bg-[var(--mint)]" />
                ) : null}
              </span>
            </Fragment>
          );
        })}
        <span className="rn num">{rows.length + 2}</span>
        <span className="font-semibold">Total</span>
        <span />
        <span className={cn("r num font-semibold transition-colors duration-500", formula && "text-[var(--mint)]")}>
          {formula ? eur(total) : ""}
        </span>
        <span />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 border-t border-[var(--line)] px-3 py-2 text-[13px]">
        <span className="rounded-md bg-[var(--panel-3)] px-2.5 py-1 font-semibold">Budget</span>
        <span className="px-2.5 py-1 text-[var(--soft)]">Receipts</span>
        <span className="px-2 py-1 text-[var(--faint)]">+</span>
        <AnimatePresence>
          {exported ? (
            <motion.span
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="ml-auto flex items-center gap-1.5 text-[var(--mint)]"
            >
              <FileText className="size-3.5" />
              launch-budget.csv
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {photo ? (
          <motion.div
            initial={{ opacity: 0, y: 16, rotate: -4 }}
            animate={{ opacity: 1, y: 0, rotate: -2 }}
            exit={{ opacity: 0, y: 30, scale: 0.9 }}
            transition={{ duration: 0.6, ease }}
            className="absolute right-4 bottom-14 flex w-[200px] items-center gap-3 rounded-xl border border-[var(--line-2)] bg-[var(--panel-2)] p-2.5 shadow-[0_20px_40px_-12px_rgb(0_0_0/70%)]"
          >
            <span className="flex h-12 w-10 shrink-0 flex-col gap-1 rounded-[4px] bg-[#e9e4d6] p-1.5">
              <span className="h-0.5 w-full bg-[#9a9283]" />
              <span className="h-0.5 w-3/4 bg-[#9a9283]" />
              <span className="h-0.5 w-full bg-[#9a9283]" />
              <span className="mt-auto h-0.5 w-1/2 bg-[#5d564a]" />
            </span>
            <span className="min-w-0 text-[12.5px] leading-snug">
              <span className="flex items-center gap-1 text-[var(--soft)]">
                <Camera className="size-3" />
                receipt-0412.jpg
              </span>
              <span className="block font-semibold">Adding 1 row…</span>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---- Both in search ---- */

const RESULTS = [
  { kind: "Doc", title: "Launch brief", where: "Website refresh" },
  { kind: "Sheet", title: "Launch budget", where: "Website refresh" },
  { kind: "Task", title: "Write the launch brief", where: "Mon 10:45" },
];

function SearchStrip() {
  return (
    <div className="panel p-3" aria-hidden>
      <div className="flex h-11 items-center gap-2.5 rounded-xl bg-[var(--panel-2)] px-3.5 text-[15px]">
        <Search className="size-4 text-[var(--faint)]" />
        launch
        <span className="ml-auto flex gap-1">
          <span className="kbd">Ctrl</span>
          <span className="kbd">K</span>
        </span>
      </div>
      <ul className="mt-1.5">
        {RESULTS.map((result, i) => (
          <li
            key={result.title}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3.5 py-2 text-[14.5px]",
              i === 0 && "bg-[rgb(168_224_195/7%)]",
            )}
          >
            <span className="w-11 text-[12.5px] text-[var(--faint)]">{result.kind}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{result.title}</span>
            <span className="hidden text-[13px] text-[var(--soft)] min-[420px]:block">{result.where}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DocsSheets() {
  return (
    <>
      <div className="ds">
        <div className="ds-col min-w-0">
          <h3>Docs</h3>
          <p>
            A block editor that speaks Markdown: type{" "}
            <code className="font-mono text-[0.9em] text-[var(--ink)]">##</code> for a heading or{" "}
            <code className="font-mono text-[0.9em] text-[var(--ink)]">/</code> for the menu. Mermaid diagrams, math,
            callouts, and export to <span className="text-[var(--ink)]">.md</span> whenever you like.
          </p>
          <DocGraphic />
        </div>
        <div className="ds-col min-w-0">
          <h3>Sheets</h3>
          <p>
            Typed columns, formulas, dropdowns and checkboxes, a fill handle, tabs, and CSV export. Photograph a receipt
            and the assistant adds the row.
          </p>
          <SheetGraphic />
        </div>
      </div>
      <div className="ds-note">
        <div>
          <p className="h3">Kept with the work they belong to.</p>
          <p className="mt-3 max-w-[34rem] text-[var(--soft)]">
            Docs and sheets live inside projects, next to the tasks they describe, and show up in search. The assistant
            can write a doc for you or add rows to a sheet.
          </p>
        </div>
        <SearchStrip />
      </div>
    </>
  );
}
