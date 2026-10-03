import { PopoverView } from "@timely/ui";
import { Check } from "lucide-react";

export const StatusMenu = () => (
  <div className="p-4" style={{ width: 300 }}>
    <PopoverView>
      <div className="w-[220px] rounded-xl border border-border bg-popover p-1.5 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10">
        {[
          ["Backlog", "#889096", false],
          ["In progress", "#0090FF", true],
          ["In review", "#FFB224", false],
          ["Done", "#30A66D", false],
        ].map(([name, color, on]) => (
          <div key={name as string} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${on ? "bg-accent text-accent-foreground" : ""}`}>
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color as string }} />
            <span className="flex-1">{name as string}</span>
            {on ? <Check className="size-3.5" /> : null}
          </div>
        ))}
      </div>
    </PopoverView>
  </div>
);

export const InfoCard = () => (
  <div className="p-4" style={{ width: 340 }}>
    <PopoverView>
      <div className="w-[280px] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-foreground/10">
        <p className="text-sm font-medium">Website relaunch</p>
        <p className="mt-1 text-xs text-muted-foreground">14 open tasks · due Jun 28</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: "62%" }} />
        </div>
      </div>
    </PopoverView>
  </div>
);
