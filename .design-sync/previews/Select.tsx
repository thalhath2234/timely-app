import { Select } from "@timely/ui";
import { useState } from "react";

const PRIORITIES = [
  { value: "urgent", label: "Urgent", color: "#E5484D" },
  { value: "high", label: "High", color: "#F76808" },
  { value: "medium", label: "Medium", color: "#FFB224" },
  { value: "low", label: "Low", color: "#30A66D" },
];

const REPEAT = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday (Mon–Fri)" },
  { value: "weekly", label: "Weekly on Tuesday" },
  { value: "custom", label: "Custom…" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex w-64 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export const Default = () => {
  const [value, setValue] = useState("weekly");
  return (
    <div className="p-4">
      <Field label="Repeat">
        <Select value={value} onChange={setValue} options={REPEAT} aria-label="Repeat" />
      </Field>
    </div>
  );
};

export const SmallWithColors = () => {
  const [value, setValue] = useState("high");
  return (
    <div className="p-4">
      <Field label="Priority">
        <Select size="sm" value={value} onChange={setValue} options={PRIORITIES} aria-label="Priority" />
      </Field>
    </div>
  );
};

export const Placeholder = () => {
  const [value, setValue] = useState("");
  return (
    <div className="p-4">
      <Field label="Project">
        <Select
          value={value}
          onChange={setValue}
          placeholder="No project"
          options={[
            { value: "p1", label: "Website relaunch" },
            { value: "p2", label: "Q4 research sprint" },
          ]}
        />
      </Field>
    </div>
  );
};

export const Disabled = () => (
  <div className="p-4">
    <Field label="Timezone">
      <Select value="eu" onChange={() => undefined} disabled options={[{ value: "eu", label: "Europe/Berlin (GMT+2)" }]} />
    </Field>
  </div>
);
