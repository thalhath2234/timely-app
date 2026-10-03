import { ChangeValue } from "@timely/ui";

const thursday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 30, 0, 0);
  return d.toISOString();
})();

export const TaskArguments = () => (
  <div className="rounded-xl border border-border bg-muted/20 p-4" style={{ width: 520 }}>
    <ChangeValue
      value={{
        title: "Draft onboarding flow",
        project: "$0.project",
        duration: 120,
        priority: "high",
        start: thursday,
        autoSchedule: false,
        labels: ["Design", "Q3"],
        notes: "",
      }}
    />
  </div>
);

export const SheetTable = () => (
  <div className="rounded-xl border border-border bg-muted/20 p-4" style={{ width: 560 }}>
    <ChangeValue
      value={{
        title: "Website relaunch budget",
        columns: [
          { id: "item", name: "Item", type: "text" },
          { id: "qty", name: "Quantity", type: "number" },
          { id: "unit", name: "Unit price", type: "currency" },
          { id: "total", name: "Total", type: "formula" },
        ],
        rows: [
          { cells: { item: "Stock photography", qty: 12, unit: 18, total: 216 } },
          { cells: { item: "Copywriting", qty: 1, unit: 900, total: 900 } },
          { cells: { item: "Usability sessions", qty: 5, unit: 75, total: 375 } },
        ],
      }}
    />
  </div>
);

export const DocMarkdown = () => (
  <div className="rounded-xl border border-border bg-muted/20 p-4" style={{ width: 520 }}>
    <ChangeValue
      value={{
        title: "Onboarding plan",
        markdown:
          "## Goals\n- Cut time-to-first-task under 2 minutes\n- Explain **auto-schedule** on day one\n\n## Next steps\n1. Draft flow\n2. Review with Sam",
      }}
    />
  </div>
);

export const Scalars = () => (
  <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm" style={{ width: 520 }}>
    <div className="flex gap-3"><span className="w-28 text-xs text-muted-foreground">Timestamp</span><ChangeValue value={thursday} /></div>
    <div className="flex gap-3"><span className="w-28 text-xs text-muted-foreground">Reference</span><ChangeValue value="$2.task" /></div>
    <div className="flex gap-3"><span className="w-28 text-xs text-muted-foreground">Number</span><ChangeValue value={45} /></div>
    <div className="flex gap-3"><span className="w-28 text-xs text-muted-foreground">Empty</span><ChangeValue value="" /></div>
  </div>
);
