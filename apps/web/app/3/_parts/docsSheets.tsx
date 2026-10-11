"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  CheckSquare,
  Download,
  FileText,
  FolderKanban,
  GitBranch,
  Heading2,
  Lightbulb,
  ListChecks,
  ReceiptText,
  Sigma,
  Sparkles,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { useLoop } from "./motion";
import { useModKey } from "./platformKey";

const spring = { type: "spring", stiffness: 300, damping: 30 } as const;

/* ---- Doc: Markdown as you type, a slash menu, a Mermaid diagram, export to .md ---- */

const MENU: { icon: LucideIcon; label: string }[] = [
  { icon: Heading2, label: "Heading" },
  { icon: CheckSquare, label: "To-do list" },
  { icon: Table2, label: "Table" },
  { icon: GitBranch, label: "Diagram" },
  { icon: Sigma, label: "Math" },
  { icon: Lightbulb, label: "Callout" },
];

const NODES = ["Brief", "Build", "Launch"];

function DocPane() {
  const { ref, frame } = useLoop(9, [1200, 900, 800, 700, 1300, 1000, 1000, 1500, 2800], 8);
  const heading = frame >= 1;
  const menu = frame === 2 || frame === 3;
  const diagram = frame >= 4;
  return (
    <div ref={ref} className="d3-doc" aria-hidden>
      <div className="d3-doc-top">
        <p className="d3-doc-title">Launch plan</p>
        <span className="d3-fake-btn d3-fake-sm" data-pressed={frame === 7 || undefined}>
          <Download className="d3-ico-xs" /> .md
        </span>
      </div>
      <p className="d3-doc-p">What has to be true before the site goes live on the 30th.</p>

      <div className="d3-doc-line">
        {heading ? (
          <motion.p className="d3-doc-h" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}>
            Milestones
          </motion.p>
        ) : (
          <p className="d3-doc-raw">
            ## Milestones<span className="d3-caret d3-caret-sm" />
          </p>
        )}
      </div>

      <div className="d3-doc-slot">
        <AnimatePresence mode="wait" initial={false}>
          {diagram ? (
            <motion.div key="diagram" className="d3-mermaid" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <span className="d3-mermaid-tag">
                <GitBranch className="d3-ico-xs" /> mermaid
              </span>
              <div className="d3-mermaid-flow">
                {NODES.map((node, index) => (
                  <span key={node} className="d3-mermaid-step">
                    <motion.span
                      className="d3-mermaid-node"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ ...spring, delay: index * 0.15 }}
                    >
                      {node}
                    </motion.span>
                    {index < NODES.length - 1 ? <span className="d3-mermaid-arrow">→</span> : null}
                  </span>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.p key="slash" className="d3-doc-raw" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {frame >= 2 ? "/" : ""}
              {heading ? <span className="d3-caret d3-caret-sm" /> : null}
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {menu ? (
            <motion.ul
              className="d3-slash"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              {MENU.map((item, index) => (
                <li key={item.label} data-on={(frame === 3 ? index === 3 : index === 0) || undefined}>
                  <item.icon className="d3-ico-xs" />
                  {item.label}
                </li>
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>

      <motion.div className="d3-callout" initial={false} animate={{ opacity: frame >= 5 ? 1 : 0.12 }} transition={{ duration: 0.3 }}>
        <Lightbulb className="d3-ico-sm" />
        Ship on a Tuesday, never on a Friday.
      </motion.div>

      <motion.p className="d3-math" initial={false} animate={{ opacity: frame >= 6 ? 1 : 0.12 }} transition={{ duration: 0.3 }}>
        <i>Σ</i> cost<sub>i</sub> ≤ €600
      </motion.p>

      <AnimatePresence>
        {frame >= 7 ? (
          <motion.p
            className="d3-toast"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
          >
            <FileText className="d3-ico-xs" /> launch-plan.md exported
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---- Sheet: typed columns, a formula, a receipt becomes a row ---- */

type Row = { item: string; category: string; cost: number; paid: boolean };

const ROWS: Row[] = [
  { item: "Domain", category: "Web", cost: 18, paid: true },
  { item: "Hosting", category: "Web", cost: 96, paid: true },
  { item: "Photos", category: "Content", cost: 120, paid: false },
  { item: "Fonts", category: "Design", cost: 240, paid: false },
];
const RECEIPT: Row = { item: "Print shop", category: "Content", cost: 42.8, paid: true };
const FORMULA = "=SUM(C2:C6)";

function money(value: number) {
  return `€${value.toFixed(value % 1 ? 2 : 0)}`;
}

function SheetPane() {
  const { ref, frame } = useLoop(8, [1000, 500, 800, 1300, 1600, 1500, 1500, 2600], 7);
  const typed = frame === 0 ? "" : frame === 1 ? FORMULA.slice(0, 5) : FORMULA;
  const computed = frame >= 3;
  const receipt = frame === 4;
  const added = frame >= 5;
  const exported = frame >= 6;
  const rows = added ? [...ROWS, RECEIPT] : ROWS;
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  return (
    <div ref={ref} className="d3-sheet" aria-hidden>
      <div className="d3-doc-top">
        <p className="d3-doc-title">Launch budget</p>
        <span className="d3-fake-btn d3-fake-sm" data-pressed={frame === 6 || undefined}>
          <Download className="d3-ico-xs" /> CSV
        </span>
      </div>
      <div className="d3-fx">
        <span className="d3-fx-cell">{computed ? "C7" : frame >= 1 ? "C7" : "C2"}</span>
        <span className="d3-fx-label">fx</span>
        <span className="d3-fx-input">
          {typed || <span className="d3-term-dim">18</span>}
          {frame >= 1 && frame < 3 ? <span className="d3-caret d3-caret-sm" /> : null}
        </span>
      </div>
      <div className="d3-grid" role="presentation">
        <div className="d3-grid-row d3-grid-head">
          <span className="d3-grid-n" />
          <span>
            <i>Aa</i> Item
          </span>
          <span>
            <i>▾</i> Category
          </span>
          <span className="d3-num">
            <i>#</i> Cost
          </span>
          <span className="d3-center">
            <i>☑</i> Paid
          </span>
        </div>
        <AnimatePresence initial={false}>
          {rows.map((row, index) => (
            <motion.div
              key={row.item}
              className="d3-grid-row"
              data-new={(row === RECEIPT && frame === 5) || undefined}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
            >
              <span className="d3-grid-n">{index + 2}</span>
              <span className="d3-grid-text">{row.item}</span>
              <span>
                <span className="d3-chip" data-cat={row.category}>
                  {row.category}
                </span>
              </span>
              <span className="d3-num" data-range={(frame >= 1 && frame < 3) || undefined}>
                {money(row.cost)}
              </span>
              <span className="d3-center">
                <span className="d3-check" data-on={row.paid || undefined}>
                  {row.paid ? "✓" : ""}
                </span>
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        <div className="d3-grid-row d3-grid-total">
          <span className="d3-grid-n">{rows.length + 2}</span>
          <span className="d3-grid-text">Total</span>
          <span />
          <span className="d3-num d3-total-cell" data-sel={!computed || undefined}>
            {computed ? (
              <motion.span key={total} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                {money(total)}
              </motion.span>
            ) : (
              <span className="d3-term-amber">{typed}</span>
            )}
          </span>
          <span />
        </div>
      </div>
      <div className="d3-sheet-tabs">
        <span data-on>Budget</span>
        <span>Receipts</span>
        <span className="d3-term-dim">+</span>
      </div>

      <AnimatePresence>
        {receipt ? (
          <motion.div
            className="d3-receipt"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={spring}
          >
            <p className="d3-receipt-head">
              <Sparkles className="d3-ico-xs" /> Receipt read by the assistant
            </p>
            <p className="d3-receipt-line">
              <ReceiptText className="d3-ico-sm" />
              Print shop · €42.80 · today
              <span className="d3-fake-btn d3-fake-amber d3-fake-sm">Add row</span>
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {exported ? (
          <motion.p className="d3-toast" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
            <Table2 className="d3-ico-xs" /> Budget tab exported as CSV
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---- Search finds both ---- */

const FOUND: { icon: LucideIcon; title: string; kind: string }[] = [
  { icon: Table2, title: "Launch budget", kind: "sheet" },
  { icon: FileText, title: "Launch plan", kind: "doc" },
  { icon: ListChecks, title: "Launch brief", kind: "task" },
  { icon: FolderKanban, title: "Website launch", kind: "project" },
];

function SearchStrip() {
  const mod = useModKey();
  const { ref, frame } = useLoop(8, [900, 220, 220, 220, 220, 260, 260, 3200], 7);
  const query = "launch".slice(0, Math.max(0, frame - 0));
  const found = frame >= 5 ? FOUND.length : 0;
  return (
    <div ref={ref} className="d3-strip" aria-hidden>
      <div className="d3-strip-bar">
        <kbd className="d3-key" data-size="sm" data-pressed={frame === 0 || undefined}>
          {mod}
        </kbd>
        <kbd className="d3-key" data-size="sm" data-pressed={frame === 0 || undefined}>
          K
        </kbd>
        <span className="d3-strip-q">
          <span className="d3-prompt">›</span> {query}
          <span className="d3-caret d3-caret-sm" />
        </span>
      </div>
      <ul className="d3-strip-list">
        {FOUND.map((item, index) => (
          <motion.li
            key={item.title}
            initial={false}
            animate={{ opacity: index < found ? 1 : 0.15, y: index < found ? 0 : 4 }}
            transition={{ ...spring, delay: index < found ? index * 0.06 : 0 }}
            data-on={(index === 0 && found > 0) || undefined}
          >
            <item.icon className="d3-ico-sm" />
            <span>{item.title}</span>
            <i>{item.kind}</i>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

export default function DocsSheetsWindow() {
  const mod = useModKey();
  return (
    <div className="d3-ds">
      <div className="d3-ds-window">
        <div className="d3-ds-tabs" aria-hidden>
          <span className="d3-ds-tab" data-on>
            <FileText className="d3-ico-xs" /> Launch plan
          </span>
          <span className="d3-ds-tab" data-on>
            <Table2 className="d3-ico-xs" /> Launch budget
          </span>
          <span className="d3-ds-tab d3-ds-new">+</span>
          <span className="d3-ds-hint">
            <kbd className="d3-key" data-size="sm">
              {mod}
            </kbd>
            <kbd className="d3-key" data-size="sm">
              Tab
            </kbd>
          </span>
        </div>
        <p className="d3-ds-crumb" aria-hidden>
          <FolderKanban className="d3-ico-xs" /> Website launch <span>›</span> docs and sheets
        </p>
        <div className="d3-ds-split">
          <DocPane />
          <SheetPane />
        </div>
      </div>
      <SearchStrip />
    </div>
  );
}
