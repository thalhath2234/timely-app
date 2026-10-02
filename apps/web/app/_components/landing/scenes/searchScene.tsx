"use client";

import { motion } from "motion/react";
import { CalendarPlus, FilePlus2, FileText, FolderKanban, ListTodo, Plus, Search, Table2 } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { DOC_TITLE, PROJECT, SHEET_TITLE, WORK } from "../sampleData";
import { Caret, SceneBox, Typed, sceneSpring, typingTime, useScene } from "../scene";

const QUERY = "launch costs";

// 0 empty · 1 typing · 2 results · 3 selection moves down · 4 back to the best match
const DELAYS = [600, typingTime(QUERY, 70), 1100, 900] as const;

const TABS = ["All", "Sheets", "Docs", "Tasks", "Projects", "Events"];

const ACTIONS = [
  { icon: Plus, label: "Create task" },
  { icon: FilePlus2, label: "Create doc" },
  { icon: CalendarPlus, label: "Go to calendar" },
];

// The app's mention tints, one per kind of result.
const RESULTS = [
  { icon: Table2, tint: "oklch(0.6 0.15 155)", kind: "Sheet", title: SHEET_TITLE, snippet: "Design, hosting and domain", byMeaning: true },
  { icon: FileText, tint: "oklch(0.62 0.16 255)", kind: "Doc", title: DOC_TITLE, snippet: "Launch is Friday 9 October", byMeaning: false },
  { icon: ListTodo, tint: "oklch(0.65 0.16 45)", kind: "Task", title: WORK.checklist.title, snippet: `${PROJECT.title} · 45m`, byMeaning: false },
  { icon: FolderKanban, tint: "oklch(0.6 0.17 300)", kind: "Project", title: PROJECT.title, snippet: `${PROJECT.workspace} · 5 open`, byMeaning: false },
];

function Scene() {
  const { ref, step } = useScene(DELAYS);
  const selected = step === 3 ? 1 : 0;

  return (
    <div ref={ref} className="absolute inset-0 flex items-center">
      <div className="mini-window flex w-full flex-col" style={{ background: "var(--popover)" }}>
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
          <Search className="size-3.5 shrink-0 text-primary" />
          <span className="mini-12 min-w-0 flex-1 truncate">
            {step === 0 ? (
              <span className="text-muted-foreground">Search anything, or run a command…</span>
            ) : (
              <>
                <Typed text={QUERY} state={step === 1 ? "typing" : "done"} speed={70} />
                <Caret />
              </>
            )}
          </span>
          <kbd className="mini-9 rounded border border-border px-1 py-0.5 font-mono text-muted-foreground">esc</kbd>
        </div>

        <div className="flex gap-1 border-b border-border px-3 py-1.5">
          {TABS.map((tab, index) => (
            <span
              key={tab}
              className={cn(
                "mini-9 rounded-full px-2 py-0.5 font-medium",
                index === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {tab}
            </span>
          ))}
        </div>

        <div className="flex h-[calc(var(--u)*168)] flex-col gap-0.5 p-1.5">
          {step < 2 ? (
            <>
              <p className="mini-9 px-2 py-1 font-semibold tracking-wider text-muted-foreground uppercase">Quick actions</p>
              {ACTIONS.map((action) => (
                <p key={action.label} className="mini-11 flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground">
                  <action.icon className="size-3 shrink-0" />
                  {action.label}
                </p>
              ))}
            </>
          ) : (
            RESULTS.map((result, index) => (
              <motion.div
                key={result.title}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...sceneSpring, delay: index * 0.07 }}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-200",
                  index === selected && "bg-accent",
                )}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-md"
                  style={{ background: `color-mix(in oklch, ${result.tint} 18%, transparent)`, color: result.tint }}
                >
                  <result.icon className="size-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mini-11 block truncate font-medium">{result.title}</span>
                  <span className="mini-9 block truncate text-muted-foreground">{result.snippet}</span>
                </span>
                {result.byMeaning ? (
                  <span className="mini-8 shrink-0 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
                    by meaning
                  </span>
                ) : null}
                <span className="mini-9 w-[calc(var(--u)*34)] shrink-0 text-right text-muted-foreground">{result.kind}</span>
              </motion.div>
            ))
          )}
        </div>

        <div className="mini-9 flex items-center gap-3 border-t border-border px-3.5 py-2 text-muted-foreground">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span className="ml-auto font-mono">Ctrl / ⌘ K</span>
        </div>
      </div>
    </div>
  );
}

export default function SearchScene() {
  return (
    <SceneBox
      height={290}
      label="A command palette: typing “launch costs” finds the Launch budget sheet by meaning, then a doc, a task and a project."
    >
      <Scene />
    </SceneBox>
  );
}
