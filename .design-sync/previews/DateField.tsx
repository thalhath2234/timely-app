import { DateField } from "@timely/ui";
import { useState } from "react";

export const ProjectDeadline = () => {
  const [value, setValue] = useState("2024-06-28T00:00:00Z");
  return (
    <label className="flex w-64 flex-col gap-1.5 p-4 text-xs font-medium text-muted-foreground">
      Project deadline
      <DateField value={value} onChange={setValue} clearable />
    </label>
  );
};

export const SmallEmpty = () => {
  const [value, setValue] = useState("");
  return (
    <label className="flex w-64 flex-col gap-1.5 p-4 text-xs font-medium text-muted-foreground">
      Start date
      <DateField value={value} onChange={setValue} size="sm" />
    </label>
  );
};
