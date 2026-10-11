"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  CheckSquare,
  Download,
  FileText,
  GitBranch,
  Heading2,
  Lightbulb,
  ReceiptText,
  Sigma,
  Sparkles,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/app/utils/cn";
import { useLoop } from "@/app/_components/site/motion";
import { Reveal } from "./reveal";

const spring = { type: "spring", stiffness: 260, damping: 26 } as const;

/* ---- Doc: a slash command turns into a diagram, then the doc exports as Markdown ---- */

const MENU: { icon: LucideIcon; label: string }[] = [
  { icon: Heading2, label: "Heading" },
  { icon: CheckSquare, label: "To-do list" },
  { icon: Table2, label: "Table" },
  { icon: GitBranch, label: "Diagram" },
  { icon: Sigma, label: "Math" },
];

const NODES = ["Brief", "Build", "Launch"];

function DocGraphic() {
  const { ref, frame } = useLoop(7, [1100, 800, 800, 1300, 1300, 1600, 1600], 6);
  const menuOpen = frame === 1 || frame === 2;
  const highlighted = frame === 2 ? 3 : 0;
  const diagram = frame >= 3;
  return (
    <div ref={ref} className="relative h-full overflow-hidden rounded-2xl border border-white/10 bg-[#111319] p-4 sm:p-5" aria-hidden>
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-semibold text-white/90">🚀 Launch plan</p>
        <motion.span
          animate={frame === 5 ? { scale: [1, 0.9, 1] } : { scale: 1 }}
          transition={{ duration: 0.35 }}
          className={cn(
            "flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors",
            frame >= 5 ? "border-[#c0c1ff]/40 bg-[#c0c1ff]/10 text-[#c0c1ff]" : "border-white/10 text-white/50",
          )}
        >
          <Download className="size-3" />
          .md
        </motion.span>
      </div>
      <p className="mt-1 text-[10px] text-white/40">Website launch · edited just now</p>

      <div className="mt-3 space-y-1.5">
        <div className="h-1.5 w-[94%] rounded-full bg-white/10" />
        <div className="h-1.5 w-[78%] rounded-full bg-white/10" />
      </div>

      <div className="relative mt-3 min-h-[118px]">
        <AnimatePresence mode="wait" initial={false}>
          {diagram ? (
            <motion.div
              key="diagram"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
            >
              <p className="flex items-center gap-1 text-[9px] font-medium text-white/35">
                <GitBranch className="size-3" />
                mermaid
              </p>
              <div className="mt-2 flex items-center justify-between gap-1">
                {NODES.map((node, index) => (
                  <div key={node} className="flex flex-1 items-center gap-1">
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ ...spring, delay: index * 0.18 }}
                      className="flex-1 rounded-lg border border-[#c0c1ff]/30 bg-[#c0c1ff]/10 py-1.5 text-center text-[10px] font-medium text-[#dcdcff]"
                    >
                      {node}
                    </motion.span>
                    {index < NODES.length - 1 ? (
                      <svg viewBox="0 0 24 8" className="w-5 shrink-0 text-white/40">
                        <motion.path
                          d="M0 4 H20 M16 1 L20 4 L16 7"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.4, delay: 0.15 + index * 0.18 }}
                        />
                      </svg>
                    ) : null}
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.p key="slash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-white/70">
              {frame >= 1 ? "/" : ""}
              <span className="s-blink ml-px inline-block h-3.5 w-px translate-y-0.5 bg-white/70" />
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {menuOpen ? (
            <motion.ul
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              className="absolute top-6 left-0 z-10 w-40 rounded-xl border border-white/10 bg-[#1a1c24] p-1 shadow-2xl shadow-black/60"
            >
              {MENU.map((item, index) => (
                <li
                  key={item.label}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1 text-[10.5px] transition-colors",
                    index === highlighted ? "bg-[#c0c1ff]/15 text-white" : "text-white/60",
                  )}
                >
                  <item.icon className="size-3" />
                  {item.label}
                </li>
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>

      <motion.div
        initial={false}
        animate={{ opacity: frame >= 4 ? 1 : 0, y: frame >= 4 ? 0 : 8 }}
        transition={spring}
        className="mt-3 flex gap-2 rounded-xl border border-[#4edea3]/25 bg-[#4edea3]/[0.06] px-3 py-2 text-[10.5px] text-white/75"
      >
        <Lightbulb className="mt-px size-3.5 shrink-0 text-[#4edea3]" />
        Ship on a Tuesday, never on a Friday.
      </motion.div>

      <AnimatePresence>
        {frame >= 5 ? (
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
            className="absolute right-4 bottom-4 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#1a1c24] px-3 py-1.5 text-[10px] text-white/75 shadow-xl shadow-black/50"
          >
            <FileText className="size-3 text-[#c0c1ff]" />
            launch-plan.md exported
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---- Sheet: a SUM formula, then a scanned receipt adds a row ---- */

const ROWS = [
  { item: "Domain", category: "Web", color: "#7cc4ff", cost: 18, paid: true },
  { item: "Hosting", category: "Web", color: "#7cc4ff", cost: 96, paid: true },
  { item: "Photos", category: "Content", color: "#f0abfc", cost: 120, paid: false },
  { item: "Fonts", category: "Design", color: "#ffb95f", cost: 240, paid: false },
];
const RECEIPT = { item: "Print shop", category: "Content", color: "#f0abfc", cost: 42.8, paid: true };
const FORMULA = "=SUM(C2:C6)";

function money(value: number) {
  return `€${value.toFixed(value % 1 ? 2 : 0)}`;
}

function SheetGraphic() {
  const { ref, frame } = useLoop(7, [1000, 600, 900, 1300, 1500, 1500, 1800], 6);
  const typed = frame === 0 ? "" : frame === 1 ? FORMULA.slice(0, 5) : FORMULA;
  const computed = frame >= 3;
  const receipt = frame >= 4;
  const added = frame >= 5;
  const rows = added ? [...ROWS, RECEIPT] : ROWS;
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  return (
    <div ref={ref} className="relative h-full overflow-hidden rounded-2xl border border-white/10 bg-[#111319]" aria-hidden>
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <p className="text-sm font-semibold text-white/90">Launch budget</p>
        <span className="font-mono text-[10px] text-white/40">{frame >= 1 && !computed ? "C8" : "Sheet 1"}</span>
      </div>
      <div className="grid grid-cols-[1.3fr_1.1fr_0.8fr_0.5fr] border-b border-white/[0.07] bg-white/[0.02] px-4 py-1.5 text-[9.5px] font-semibold text-white/45">
        <span>Item</span>
        <span>Category</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Paid</span>
      </div>
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <motion.div
            key={row.item}
            initial={{ opacity: 0, height: 0, backgroundColor: "rgba(192,193,255,0.18)" }}
            animate={{ opacity: 1, height: "auto", backgroundColor: "rgba(192,193,255,0)" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ ...spring, backgroundColor: { duration: 1.6 } }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-[1.3fr_1.1fr_0.8fr_0.5fr] items-center border-b border-white/[0.05] px-4 py-[7px] text-[10.5px] text-white/75">
              <span className="truncate">{row.item}</span>
              <span>
                <span
                  className="rounded-full px-1.5 py-px text-[9px] font-medium"
                  style={{ color: row.color, background: `color-mix(in oklch, ${row.color} 14%, transparent)` }}
                >
                  {row.category}
                </span>
              </span>
              <span
                className={cn(
                  "rounded text-right font-mono transition-colors",
                  frame === 2 && "bg-[#c0c1ff]/10 text-[#dcdcff] outline outline-1 outline-[#c0c1ff]/40",
                )}
              >
                {money(row.cost)}
              </span>
              <span className="flex justify-end">
                <span
                  className={cn(
                    "flex size-3 items-center justify-center rounded-[3px] border",
                    row.paid ? "border-[#4edea3] bg-[#4edea3]" : "border-white/25",
                  )}
                >
                  {row.paid ? <span className="text-[7px] leading-none font-bold text-[#06281b]">✓</span> : null}
                </span>
              </span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="grid grid-cols-[1.3fr_1.1fr_0.8fr_0.5fr] items-center px-4 py-2 text-[10.5px] font-semibold">
        <span className="text-white/60">Total</span>
        <span />
        <span className="text-right font-mono">
          {computed ? (
            <motion.span key={total} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="inline-block text-white">
              {money(total)}
            </motion.span>
          ) : (
            <span className="text-[#c0c1ff]">
              {typed}
              <span className="s-blink ml-px inline-block h-3 w-px translate-y-0.5 bg-[#c0c1ff]" />
            </span>
          )}
        </span>
        <span />
      </div>

      <AnimatePresence>
        {receipt && !added ? (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={spring}
            className="absolute inset-x-4 bottom-4 rounded-xl border border-white/10 bg-[#1a1c24] p-3 shadow-2xl shadow-black/60"
          >
            <p className="flex items-center gap-1.5 text-[10px] font-semibold text-[#c0c1ff]">
              <Sparkles className="size-3" />
              Receipt read by the assistant
            </p>
            <p className="mt-1 flex items-center gap-2 text-[11px] text-white/80">
              <ReceiptText className="size-3.5 text-white/45" />
              Print shop · €42.80 · today
              <span className="ml-auto rounded-full bg-[#c0c1ff] px-2 py-0.5 text-[10px] font-semibold text-[#1000a9]">Add</span>
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const DOC_FEATURES = [
  "Markdown in and out",
  "Slash menu",
  "Mentions and backlinks",
  "Mermaid diagrams",
  "Maths",
  "Callouts and footnotes",
  "Version history",
  "Templates and daily notes",
];

const SHEET_FEATURES = [
  "Typed columns",
  "Formulas",
  "Dropdowns and checkboxes",
  "Fill handle",
  "Tabs",
  "Filter and sort",
  "Templates",
  "CSV export",
];

function ShowcaseCard({
  eyebrow,
  title,
  body,
  graphic,
  features,
  href,
  delay = 0,
}: {
  eyebrow: string;
  title: string;
  body: string;
  graphic: React.ReactNode;
  features: string[];
  href: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className="flex min-w-0 flex-col">
      <div className="h-[330px]">{graphic}</div>
      <p className="mt-6 text-xs font-semibold tracking-wide text-[var(--lp-now)] uppercase">{eyebrow}</p>
      <h3 className="lp-display mt-2 text-3xl leading-none">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-[var(--lp-soft)]">{body}</p>
      <ul className="mt-4 flex flex-wrap gap-1.5">
        {features.map((feature) => (
          <li key={feature} className="lp-mono rounded-md border border-[var(--lp-line)] px-2 py-1 text-[11px] text-[var(--lp-soft)]">
            {feature}
          </li>
        ))}
      </ul>
      <a href={href} className="mt-5 inline-block text-sm font-medium text-[var(--lp-now)] hover:underline">
        Learn more →
      </a>
    </Reveal>
  );
}

export default function DocsSheetsShowcase() {
  return (
    <div className="mt-14 grid gap-x-8 gap-y-14 lg:grid-cols-2">
      <ShowcaseCard
        eyebrow="Docs"
        title="Write it down where the work is."
        body="Nested pages with a block editor that speaks Markdown. Type / for anything, @ to link a task or project, and export to .md that reads well in GitHub and Obsidian."
        graphic={<DocGraphic />}
        features={DOC_FEATURES}
        href="/help/notes/docs"
      />
      <ShowcaseCard
        delay={0.08}
        eyebrow="Sheets"
        title="Numbers without a separate spreadsheet."
        body="Budgets, trackers and lists with real formulas, kept in the same project as the tasks they belong to. The assistant can build a sheet for you or add a row from a photo of a receipt."
        graphic={<SheetGraphic />}
        features={SHEET_FEATURES}
        href="/help/notes/sheets"
      />
    </div>
  );
}
