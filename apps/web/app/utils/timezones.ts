/** IANA zones the runtime knows about, plus UTC as a guaranteed fallback. */
export function listTimezones(current?: string): string[] {
  let zones: string[] = [];
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported?.length) zones = [...supported];
  } catch {
    // Older runtimes: fall through.
  }
  if (zones.length === 0) zones = ["UTC"];
  if (!zones.includes("UTC")) zones.unshift("UTC");
  if (current && !zones.includes(current)) zones.push(current);
  return zones;
}

export type TimezoneGroup = {
  region: string;
  zones: { value: string; label: string }[];
};

/** Groups `Area/Location` identifiers so a picker can show optgroups by region. */
export function groupTimezones(zones: string[]): TimezoneGroup[] {
  const byRegion = new Map<string, { value: string; label: string }[]>();
  for (const value of zones) {
    const slash = value.indexOf("/");
    const region = slash === -1 ? "Other" : value.slice(0, slash);
    const rest = slash === -1 ? value : value.slice(slash + 1);
    const label = rest.replace(/_/g, " ");
    const list = byRegion.get(region) ?? [];
    list.push({ value, label });
    byRegion.set(region, list);
  }

  const regions = Array.from(byRegion.keys()).sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  return regions.map((region) => ({
    region,
    zones: (byRegion.get(region) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
  }));
}
