import { DatePicker, PropertyRow, Select } from "@timely/ui";
import { CalendarDays, Circle, Clock, Flag } from "lucide-react";

const selectClass = "border-0 bg-transparent px-0 shadow-none";

const Panel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col gap-1 rounded-xl border border-border bg-muted/10 px-5 py-4" style={{ width: 360 }}>
    {children}
  </div>
);

export const TaskProperties = () => (
  <Panel>
    <PropertyRow icon={Circle} label="Status">
      <Select size="sm" value="s2" onChange={() => undefined} className={selectClass}
        options={[{ value: "s1", label: "Backlog", color: "#889096" }, { value: "s2", label: "In progress", color: "#0090FF" }]} />
    </PropertyRow>
    <PropertyRow icon={Flag} label="Priority">
      <Select size="sm" value="Urgent" onChange={() => undefined} className={selectClass}
        options={[{ value: "Urgent", label: "Urgent", color: "#E5484D" }]} />
    </PropertyRow>
    <PropertyRow icon={Clock} label="Duration">
      <input type="number" defaultValue={45} className="w-full bg-transparent text-sm text-foreground outline-none" />
      <span className="shrink-0 text-xs text-muted-foreground">min</span>
    </PropertyRow>
    <PropertyRow icon={CalendarDays} label="Deadline">
      <DatePicker value="2024-05-24" onChange={() => undefined} />
    </PropertyRow>
  </Panel>
);

export const LongLabelAndText = () => (
  <Panel>
    <PropertyRow icon={Clock} label="Estimated review time (minutes)">
      <span className="text-xs text-foreground">30</span>
    </PropertyRow>
    <PropertyRow icon={CalendarDays} label="Start date">
      <span className="text-xs text-muted-foreground">Not set</span>
    </PropertyRow>
  </Panel>
);
