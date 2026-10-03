import { OverlayPanel, OverlayScrim } from "@timely/ui";
import { Search, Trash2 } from "lucide-react";

export const ConfirmPanel = () => (
  <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-background p-4" style={{ width: 560, height: 300 }}>
    <OverlayScrim className="bg-black/55" />
    <OverlayPanel role="alertdialog" className="relative w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-2xl">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <Trash2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="text-sm font-semibold text-foreground">Delete “Prepare sprint demo”?</h2>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">Its checklist and calendar block go with it.</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground">Cancel</button>
        <button type="button" className="rounded-lg bg-destructive-container px-3 py-1.5 text-sm font-medium text-destructive-foreground">Delete</button>
      </div>
    </OverlayPanel>
  </div>
);

export const PalettePanel = () => (
  <div className="relative flex items-start justify-center overflow-hidden rounded-xl bg-background p-6" style={{ width: 640, height: 320 }}>
    <OverlayScrim className="bg-black/55" />
    <OverlayPanel role="dialog" className="relative w-full max-w-[420px] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Search className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Search tasks, projects, docs…</span>
      </div>
      <div className="flex flex-col p-1.5 text-sm">
        {["Draft onboarding flow", "Website relaunch", "Q4 research sprint"].map((name, i) => (
          <div key={name} className={`rounded-md px-2 py-1.5 ${i === 0 ? "bg-accent text-accent-foreground" : "text-foreground"}`}>{name}</div>
        ))}
      </div>
    </OverlayPanel>
  </div>
);
