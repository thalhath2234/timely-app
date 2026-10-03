import { TaskTypeToggle } from "@timely/ui";
import { useState } from "react";

const Hint = ({ reminder }: { reminder: boolean }) => (
  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
    {reminder
      ? "Pings at a chosen time. Does not reserve a work block."
      : "Estimated minutes of work the scheduler can place."}
  </p>
);

export const Work = () => {
  const [value, setValue] = useState<"task" | "reminder">("task");
  return (
    <div className="w-[320px] px-5 py-4">
      <TaskTypeToggle value={value} onChange={setValue} />
      <Hint reminder={value === "reminder"} />
    </div>
  );
};

export const Reminder = () => {
  const [value, setValue] = useState<"task" | "reminder">("reminder");
  return (
    <div className="w-[320px] px-5 py-4">
      <TaskTypeToggle value={value} onChange={setValue} />
      <Hint reminder={value === "reminder"} />
    </div>
  );
};
