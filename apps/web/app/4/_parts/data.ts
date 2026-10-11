/** Shared facts for design 4: project colours, the week on show, and the download table. */

export const BASE = "/4";

/** Timely's project colours, as flat blocks. `ink` is the text colour that reads on each. */
export const C = {
  green: { bg: "#30a66d", ink: "#06150d" },
  violet: { bg: "#6e56cf", ink: "#ffffff" },
  amber: { bg: "#ffb224", ink: "#1a1100" },
  blue: { bg: "#0090ff", ink: "#00101f" },
  pink: { bg: "#e93d82", ink: "#1f0310" },
  cyan: { bg: "#00a2c7", ink: "#001419" },
  orange: { bg: "#f76808", ink: "#1f0b00" },
} as const;

export type ColorName = keyof typeof C;

export const PROJECTS: Record<string, ColorName> = {
  "Website refresh": "violet",
  "Move to the new flat": "green",
  "Learn Spanish": "amber",
  "Portfolio launch": "blue",
  Studio: "pink",
  Northwind: "cyan",
  Health: "orange",
};

/** ISO week 42 of 2026: Monday 12 to Sunday 18 October. */
export const WEEK = {
  number: 42,
  label: "12–18 Oct 2026",
  days: [
    { short: "Mon", date: 12 },
    { short: "Tue", date: 13 },
    { short: "Wed", date: 14 },
    { short: "Thu", date: 15 },
    { short: "Fri", date: 16 },
    { short: "Sat", date: 17 },
    { short: "Sun", date: 18 },
  ],
};

export function navFor(base: string) {
  return [
    { href: `${base}#ai`, label: "AI", num: "01" },
    { href: `${base}#how-it-works`, label: "How it works", num: "02" },
    { href: `${base}#docs-and-sheets`, label: "Docs and sheets", num: "03" },
    { href: `${base}#download`, label: "Download", num: "06" },
    { href: `${base}/help`, label: "Help", num: "?" },
  ];
}

/** "9.5" -> "09:30" */
export function clock(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
