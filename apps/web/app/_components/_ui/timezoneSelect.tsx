"use client";

import { useMemo } from "react";
import { groupTimezones, listTimezones } from "@/app/utils/timezones";
import { cn } from "@/app/utils/cn";

const fieldClass =
  "rounded-lg border border-border bg-input/30 px-2 py-1.5 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40";

export default function TimezoneSelect({
  value,
  onChange,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
}) {
  const groups = useMemo(() => groupTimezones(listTimezones(value)), [value]);

  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(fieldClass, className)}
    >
      {groups.map((group) => (
        <optgroup key={group.region} label={group.region}>
          {group.zones.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label === zone.value ? zone.label : `${zone.label} (${zone.value})`}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
