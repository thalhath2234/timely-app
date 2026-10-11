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
  "aria-label": ariaLabel = "Timezone",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: ControlSize;
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
      searchable
      className={className}
      aria-label={ariaLabel}
    />
  );
}
