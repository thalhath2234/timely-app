"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, FileText, Heading1, ListChecks, Table2, Type } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { DOC_TITLE, SHEET_TITLE } from "../sampleData";
import { Caret, MiniWindow, SceneBox, Typed, sceneEase, sceneSpring, typingTime, useScene } from "../scene";

const FORMULA = "=SUM(B2:B4)";

// 0 doc at rest · 1 slash menu · 2 to-do inserted · 3 mention inserted · 4 formula typed · 5 result
const DELAYS = [700, 1300, 900, 1100, typingTime(FORMULA, 80)] as const;

const SLASH_ITEMS = [
  { icon: Type, label: "Text" },
  { icon: Heading1, label: "Heading 1" },
  { icon: ListChecks, label: "To-do list" },
  { icon: Table2, label: "Table" },
  { icon: FileText, label: "Page" },
];

const ROWS = [
  ["Design", "1,200.00"],
  ["Hosting", "48.00"],
  ["Domain", "14.00"],
];

function Todo({ done, children }: { done?: boolean; children: React.ReactNode }) {
  return (
    <p className="mini-10 flex items-center gap-1.5">
      <span
        className={cn(
          "flex size-2.5 shrink-0 items-center justify-center rounded-[calc(var(--u)*2)] border",
          done ? "border-primary bg-primary" : "border-muted-foreground",
        )}
      >
        {done ? <Check className="size-2 text-primary-foreground" strokeWidth={4} /> : null}
      </span>
      <span className={cn(done && "text-muted-foreground line-through")}>{children}</span>
    </p>
  );
}

function Scene() {
  const { ref, step } = useScene(DELAYS);
  const sheetFocused = step >= 4;

  return (
    <div ref={ref} className="absolute inset-0">
      <motion.div
        className="absolute top-0 left-0 h-[72%] w-[64%]"
        style={{ zIndex: sheetFocused ? 1 : 2 }}
        initial={false}
        animate={{ scale: sheetFocused ? 0.97 : 1 }}
        transition={sceneEase}
      >
        <MiniWindow title="Docs" className="h-full">
          <div className="relative flex flex-col gap-1.5 p-3">
            <p className="mini-14 font-semibold">{DOC_TITLE}</p>
            <p className="mini-10 leading-snug text-muted-foreground">
              Launch is Friday 9 October. Before then:
            </p>
            <Todo done>Approve the brief</Todo>
            <AnimatePresence initial={false}>
              {step >= 2 ? (
                <motion.div key="todo" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={sceneEase}>
                  <Todo>Confirm hosting</Todo>
                </motion.div>
              ) : null}
              {step >= 3 ? (
                <motion.p
                  key="mention"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={sceneEase}
                  className="mini-10 flex flex-wrap items-center gap-1"
                >
                  Costs live in
                  <span
                    data-entity-type="sheet"
                    className="mention-swatch inline-flex items-center gap-1 rounded-md px-1 py-px font-medium"
                  >
                    <Table2 className="size-2.5" />
                    {SHEET_TITLE}
                  </span>
                </motion.p>
              ) : null}
            </AnimatePresence>
            {step === 1 ? (
              <div className="relative">
                <p className="mini-10">
                  /<Caret />
                </p>
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={sceneSpring}
                  className="absolute top-full left-0 z-10 mt-1 w-[calc(var(--u)*118)] rounded-lg border border-border bg-popover p-1 shadow-lg"
                >
                  {SLASH_ITEMS.map((item) => (
                    <p
                      key={item.label}
                      className={cn(
                        "mini-10 flex items-center gap-1.5 rounded-md px-1.5 py-1",
                        item.label === "To-do list" ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
                      )}
                    >
                      <item.icon className="size-2.5 shrink-0" />
                      {item.label}
                    </p>
                  ))}
                </motion.div>
              </div>
            ) : null}
          </div>
        </MiniWindow>
      </motion.div>

      <motion.div
        className="absolute right-0 bottom-0 h-[52%] w-[58%]"
        style={{ zIndex: sheetFocused ? 2 : 1 }}
        initial={false}
        animate={{ scale: sheetFocused ? 1 : 0.97 }}
        transition={sceneEase}
      >
        <MiniWindow title={SHEET_TITLE} className="h-full">
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
              <span className="mini-9 rounded border border-border px-1 font-mono text-muted-foreground">B5</span>
              <span className="mini-9 text-muted-foreground italic">fx</span>
              <span className="mini-10 min-w-0 flex-1 truncate font-mono">
                {step >= 4 ? <Typed text={FORMULA} done={step > 4} speed={80} /> : null}
                {step === 4 ? <Caret /> : null}
              </span>
            </div>
            <div className="mini-10 grid flex-1 grid-cols-[calc(var(--u)*18)_1fr_1fr] grid-rows-5 font-mono">
              {[["Item", "Cost"], ...ROWS, ["Total", ""]].map(([item, cost], row) => (
                <div key={item} className="contents">
                  <span className="mini-8 flex items-center justify-center border-r border-b border-border bg-card text-muted-foreground">
                    {row + 1}
                  </span>
                  <span
                    className={cn(
                      "flex items-center border-r border-b border-border px-1.5 font-sans",
                      (row === 0 || row === 4) && "font-semibold",
                    )}
                  >
                    {item}
                  </span>
                  <span
                    className={cn(
                      "relative flex items-center justify-end border-b border-border px-1.5",
                      row === 0 && "font-sans font-semibold",
                      row === 4 && sheetFocused && "outline-2 -outline-offset-2 outline-primary",
                    )}
                  >
                    {row < 4 ? cost : null}
                    {row === 4 && step >= 5 ? (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={sceneSpring}
                        className="font-semibold"
                      >
                        1,262.00
                      </motion.span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </MiniWindow>
      </motion.div>
    </div>
  );
}

export default function DocsSheetsScene() {
  return (
    <SceneBox
      height={345}
      label="In a doc, a slash menu inserts a to-do and a mention links to a sheet; in the sheet, a SUM formula totals three costs."
    >
      <Scene />
    </SceneBox>
  );
}
