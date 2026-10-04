import { PropertyRow, RecurrenceEditor } from "@timely/ui";
import { Clock, Repeat } from "lucide-react";
import { useState } from "react";

// Thursday 16 May 2024, 09:00 local: the first occurrence.
const anchor = new Date(2024, 4, 16, 9, 0);

const weekly = { freq: "WEEKLY", interval: 1, byDay: [4], monthlyMode: "day", byMonthDay: [], byMonth: [], end: { type: "never" } };
const everyOtherMWF = { freq: "WEEKLY", interval: 2, byDay: [1, 3, 5], monthlyMode: "day", byMonthDay: [], byMonth: [], end: { type: "count", count: 12 } };
const monthly = { freq: "MONTHLY", interval: 1, byDay: [], monthlyMode: "day", byMonthDay: [1, 15], byMonth: [], end: { type: "until", date: "2024-12-31" } };

const Sidebar = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col gap-1 border border-border bg-muted/10 px-5 py-5" style={{ width: 360 }}>
    {children}
  </div>
);

export const PropertyRowWeekly = () => {
  const [value, setValue] = useState<any>(weekly);
  return (
    <div className="p-4">
      <Sidebar>
        <PropertyRow icon={Clock} label="Schedule">
          <span className="text-xs text-foreground">Thu, May 16 · 9:00 AM</span>
        </PropertyRow>
        <RecurrenceEditor label="Repeat" icon={Repeat} value={value} anchor={anchor} onChange={setValue} />
      </Sidebar>
    </div>
  );
};

export const CustomWeekly = () => {
  const [value, setValue] = useState<any>(everyOtherMWF);
  return (
    <div className="p-4">
      <Sidebar>
        <RecurrenceEditor label="Repeat" icon={Repeat} value={value} anchor={anchor} onChange={setValue} />
      </Sidebar>
    </div>
  );
};

export const CustomMonthly = () => {
  const [value, setValue] = useState<any>(monthly);
  return (
    <div className="p-4">
      <Sidebar>
        <RecurrenceEditor label="Repeat" icon={Repeat} value={value} anchor={anchor} onChange={setValue} />
      </Sidebar>
    </div>
  );
};

export const InlineDoesNotRepeat = () => {
  const [value, setValue] = useState<any>(null);
  return (
    <div className="flex w-[320px] flex-col gap-1.5 p-4">
      <span className="text-xs font-medium text-muted-foreground">Repeat</span>
      <RecurrenceEditor value={value} anchor={anchor} onChange={setValue} />
    </div>
  );
};

export const Disabled = () => (
  <div className="p-4">
    <Sidebar>
      <RecurrenceEditor label="Repeat" icon={Repeat} value={everyOtherMWF as any} anchor={anchor} onChange={() => undefined} disabled />
    </Sidebar>
  </div>
);
