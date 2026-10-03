import { TimeField } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

export const ReminderTime = () => {
  const [value, setValue] = useState("08:15");
  return (
    <label className="flex w-48 flex-col gap-1.5 p-4 text-xs font-medium text-muted-foreground">
      Notify at
      <TimeField value={value} onChange={setValue} aria-label="Notify at" />
    </label>
  );
};

export const Open = () => {
  const [value, setValue] = useState("17:45");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.click();
  }, []);
  return (
    <div ref={ref} className="p-4" style={{ width: 300, height: 340 }}>
      <TimeField value={value} onChange={setValue} className="w-40" aria-label="Time" />
    </div>
  );
};

export const ClearableEmpty = () => {
  const [value, setValue] = useState("");
  return (
    <label className="flex w-48 flex-col gap-1.5 p-4 text-xs font-medium text-muted-foreground">
      Time (optional)
      <TimeField value={value} onChange={setValue} clearable aria-label="Time" />
    </label>
  );
};
