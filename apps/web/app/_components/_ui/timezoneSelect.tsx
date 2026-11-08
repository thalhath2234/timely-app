"use client";

import { useMemo } from "react";
import { groupTimezones, listTimezones } from "@/app/utils/timezones";
import Select, { type SelectOption } from "@/app/_components/_ui/select";
import type { ControlSize } from "@/app/_components/_ui/field";

/** Timezone picker: the shared Select, grouped by region, with a search box. */
export default function TimezoneSelect({
  value,
  onChange,
  className,
  size = "md",
  variant,
  "aria-label": ariaLabel = "Timezone",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: ControlSize;
  /** "row": the value side of a grouped row. */
  variant?: "default" | "row";
  "aria-label"?: string;
}) {
  const options = useMemo<SelectOption[]>(
    () =>
      groupTimezones(listTimezones(value)).flatMap((group) =>
        group.zones.map((zone) => ({
          value: zone.value,
          label: zone.label === zone.value ? zone.label : `${zone.label} (${zone.value})`,
          group: group.region,
        })),
      ),
    [value],
  );

  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      size={size}
      variant={variant}
      // A row's trigger is only as wide as its value: the menu needs room
      // for "Kamchatka (Asia/Kamchatka)", and opens from the row's right edge.
      menuMinWidth={320}
      searchable
      className={className}
      aria-label={ariaLabel}
    />
  );
}
