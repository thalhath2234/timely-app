import { DateTimeField } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

export const EventStart = () => {
  const [value, setValue] = useState("2024-05-16T13:00");
  return (
    <label className="flex w-72 flex-col gap-1.5 p-4 text-xs font-medium text-muted-foreground">
      Starts
      <DateTimeField value={value} onChange={setValue} clearable />
    </label>
  );
};

export const Open = () => {
  const [value, setValue] = useState("2024-05-17T08:30");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.click();
  }, []);
  return (
    <div ref={ref} className="p-4" style={{ width: 360, height: 560 }}>
      <DateTimeField value={value} onChange={setValue} className="w-64" />
    </div>
  );
};

export const Empty = () => {
  const [value, setValue] = useState("");
  return (
    <label className="flex w-72 flex-col gap-1.5 p-4 text-xs font-medium text-muted-foreground">
      Follow-up reminder
      <DateTimeField value={value} onChange={setValue} />
    </label>
  );
};
