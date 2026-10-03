import { DatePicker } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

/** Clicks the trigger once on mount so the calendar panel is visible. */
function OpenOnMount({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex w-64 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
    {label}
    {children}
  </label>
);

export const Deadline = () => {
  const [value, setValue] = useState("2024-05-17");
  return (
    <div className="p-4">
      <Field label="Deadline">
        <DatePicker value={value} onChange={setValue} aria-label="Deadline" />
      </Field>
    </div>
  );
};

export const CalendarOpen = () => {
  const [value, setValue] = useState("2024-05-21");
  return (
    <div className="p-4" style={{ width: 340, height: 440 }}>
      <OpenOnMount>
        <DatePicker value={value} onChange={setValue} className="w-64" aria-label="Start date" />
      </OpenOnMount>
    </div>
  );
};

export const DateTimeOpen = () => {
  const [value, setValue] = useState("2024-05-16T14:30");
  return (
    <div className="p-4" style={{ width: 360, height: 560 }}>
      <OpenOnMount>
        <DatePicker mode="datetime" value={value} onChange={setValue} className="w-64" aria-label="Schedule" />
      </OpenOnMount>
    </div>
  );
};

export const TimeOpen = () => {
  const [value, setValue] = useState("09:30");
  return (
    <div className="p-4" style={{ width: 300, height: 340 }}>
      <OpenOnMount>
        <DatePicker mode="time" value={value} onChange={setValue} clearable={false} className="w-40" aria-label="Notify at" />
      </OpenOnMount>
    </div>
  );
};

export const EmptySmallAndDisabled = () => (
  <div className="flex flex-col gap-3 p-4">
    <Field label="Start date (empty)">
      <DatePicker value="" onChange={() => undefined} />
    </Field>
    <Field label="Small, reminder time">
      <DatePicker size="sm" mode="datetime" value="" placeholder="Pick when to ping" onChange={() => undefined} />
    </Field>
    <Field label="Locked by recurrence">
      <DatePicker value="2024-05-20" onChange={() => undefined} disabled />
    </Field>
  </div>
);
