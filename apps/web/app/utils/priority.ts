export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export function normalizePriority(value?: string | null): Priority | "" {
  switch ((value ?? "").trim().toLowerCase()) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "urgent":
    case "critical":
      return "Urgent";
    default:
      return "";
  }
}

export function priorityRank(value?: string | null): number {
  switch (normalizePriority(value)) {
    case "Urgent":
      return 0;
    case "High":
      return 1;
    case "Medium":
      return 2;
    case "Low":
      return 3;
    default:
      return 4;
  }
}

export const PRIORITY_OPTIONS = PRIORITIES.map((value) => ({
  value,
  label: value,
}));

export function priorityColor(value?: string | null): string | null {
  switch (normalizePriority(value)) {
    case "Urgent":
      return "#E5484D";
    case "High":
      return "#F76808";
    case "Medium":
      return "#FFB224";
    case "Low":
      return "#889096";
    default:
      return null;
  }
}
