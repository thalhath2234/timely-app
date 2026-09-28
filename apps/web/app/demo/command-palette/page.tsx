"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Command, Search } from "lucide-react";
import SearchModal from "@/app/_components/_ui/modal/search";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import type { SearchHit } from "@/app/utils/api/search";

const samples: SearchHit[] = [
  { id: "roadmap", kind: "sheet", title: "Product roadmap", snippet: "Planning · Milestones, priorities, and what’s next" },
  { id: "brief", kind: "doc", title: "Website launch brief", snippet: "Notes · A clear plan for launch day" },
  { id: "review", kind: "task", title: "Review the launch checklist", snippet: "Website refresh · In progress" },
  { id: "budget", kind: "sheet", title: "Launch budget", snippet: "Planning · Track estimates and actual costs" },
  { id: "notes", kind: "doc", title: "Ideas for a calmer workspace", snippet: "Personal · Small improvements, better focus" },
  { id: "design", kind: "project", title: "Website refresh", snippet: "Projects · Design, build, and launch" },
  { id: "planning", kind: "event", title: "Weekly planning", snippet: "Calendar · Make room for what matters" },
];

export default function CommandPaletteDemo() {
  const [selection, setSelection] = useState<string | null>(null);
  const setSearchMode = useSidebarStore((state) => state.setSearchMode);
  useEffect(() => { setSearchMode(true); return () => setSearchMode(false); }, [setSearchMode]);
  const sample = samples.find((item) => item.title === selection);
  return (
    <main id="main-content" className="min-h-screen overflow-y-auto bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-5 sm:px-12">
        <span className="flex items-center gap-2 font-semibold"><Command size={19} className="text-primary" /> Timely</span>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Command palette demo</span>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary">A shortcut to everything</p>
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">Your workspace.<br />At your fingertips.</h1>
        <p className="mt-5 max-w-lg text-sm leading-7 text-muted-foreground">Find a sheet, jump into a doc, or start something new. One command palette brings it all together.</p>
        <button onClick={() => setSearchMode(true)} className="mt-8 flex w-full max-w-lg items-center gap-3 rounded-xl border border-border bg-popover px-4 py-4 text-sm shadow-sm transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring">
          <Search size={18} className="text-primary" /><span className="flex-1 text-left">Open command palette</span><kbd className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">Ctrl / ⌘ K</kbd>
        </button>
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {[["01", "Find your focus", "Tabs for sheets, docs, tasks, projects, and events."], ["02", "Keep your hands on the keys", "Use ↑ ↓ to navigate and Enter to open. Escape brings you back."], ["03", "Do more in one place", "Type “create” or “go to” to discover quick actions."]].map(([number, title, body]) => <div key={number} className="rounded-xl border border-border bg-card p-5"><span className="text-xs text-primary">{number}</span><h2 className="mt-4 text-sm font-medium">{title}</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">{body}</p></div>)}
        </div>
        {selection && <section aria-live="polite" className="mt-6 rounded-xl border border-primary/25 bg-primary/5 p-6"><p className="flex items-center gap-2 text-xs text-primary"><ArrowUpRight size={14} />{sample ? `${sample.kind} preview` : "Command preview"}</p><h2 className="mt-3 text-xl font-semibold">{selection}</h2><p className="mt-2 text-sm text-muted-foreground">{sample?.snippet ?? "In your workspace, this command opens the corresponding page or creation form."}</p></section>}
        <p className="mt-8 text-xs leading-6 text-muted-foreground">Interactive preview with sample data. Your real workspace and search use the same palette.</p>
      </div>
      <SearchModal demoItems={samples} onDemoSelect={setSelection} />
    </main>
  );
}
