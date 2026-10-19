import { ListGroup, ListRow, RecurrenceEditor } from "@timely/ui";
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

const Card = ({ initial, disabled }: { initial: any; disabled?: boolean }) => {
  const [value, setValue] = useState<any>(initial);
  return (
    <div className="p-4">
      <Sidebar>
        <ListGroup>
          <ListRow label="Schedule">
            <span className="text-[13px] font-medium text-muted-foreground">Thu, May 16, 9:00 AM</span>
          </ListRow>
          <RecurrenceEditor label="Repeat" value={value} anchor={anchor} onChange={setValue} disabled={disabled} />
        </ListGroup>
      </Sidebar>
    </div>
  );
};

export const RowWeekly = () => <Card initial={weekly} />;
export const CustomWeekly = () => <Card initial={everyOtherMWF} />;
export const CustomMonthly = () => <Card initial={monthly} />;
export const DoesNotRepeat = () => <Card initial={null} />;
export const Disabled = () => <Card initial={everyOtherMWF} disabled />;
