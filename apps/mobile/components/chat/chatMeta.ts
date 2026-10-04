import {
  AlertTriangle,
  Ban,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  FolderKanban,
  Layers,
  ListChecks,
  LoaderCircle,
  MapPin,
  Search,
  Sun,
  Table2,
  TextSelect,
  Timer,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react-native";
import type { Chat, ChatStep } from "../../lib/chat/types";
import type { ThemeColors } from "../../lib/theme";

const chipIcons: Record<string, LucideIcon> = {
  location: MapPin,
  object: FileText,
  workspace: Layers,
  project: FolderKanban,
  selection: TextSelect,
  "sheet-tab": Table2,
  calendar: CalendarDays,
  today: Sun,
  search: Search,
  tasks: ListChecks,
  "task-view": ListChecks,
  draft: FileText,
};
export function chipIcon(kind: string): LucideIcon {
  return chipIcons[kind] || MapPin;
}
export function isBusy(status?: string) {
  return status === "queued" || status === "running";
}
export type Tone = "primary" | "warning" | "destructive" | "muted" | "success";
export function toneColor(tone: Tone, colors: ThemeColors) {
  switch (tone) {
    case "primary":
      return colors.primary;
    case "warning":
      return colors.warning;
    case "destructive":
      return colors.destructive;
    case "success":
      return colors.success;
    default:
      return colors.mutedForeground;
  }
}
export function statusMeta(status: string): {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  spin?: boolean;
} {
  switch (status) {
    case "queued":
      return { label: "Queued", tone: "primary", icon: Clock };
    case "running":
      return {
        label: "Working",
        tone: "primary",
        icon: LoaderCircle,
        spin: true,
      };
    case "approval":
      return {
        label: "Needs your review",
        tone: "warning",
        icon: AlertTriangle,
      };
    case "failed":
      return {
        label: "Needs attention",
        tone: "destructive",
        icon: AlertTriangle,
      };
    case "stopped":
      return { label: "Stopped", tone: "muted", icon: Ban };
    default:
      return { label: "Ready", tone: "muted", icon: CheckCircle2 };
  }
}
export function phaseLabel(phase?: string) {
  switch (phase) {
    case "apply":
      return "Saving your changes…";
    case "extract":
      return "Reading your images…";
    case "receipt_edit":
      return "Revising your receipt…";
    case "receipt_plan":
      return "Refreshing the receipt proposal…";
    default:
      return "Thinking it through…";
  }
}
export function stepMeta(
  status: string,
  active = false,
): { label: string; icon: LucideIcon; tone: Tone; spin?: boolean } {
  if (status === "done") return { label: "Done", icon: Check, tone: "success" };
  if (status === "failed")
    return { label: "Failed", icon: AlertTriangle, tone: "destructive" };
  if (status === "discarded")
    return { label: "Discarded", icon: Ban, tone: "muted" };
  if (active)
    return {
      label: "In progress",
      icon: LoaderCircle,
      tone: "primary",
      spin: true,
    };
  return { label: "Pending", icon: Circle, tone: "muted" };
}
/** Deletions and clearing blocks remove data; their review cards say so. */
export function isRemoval(tool: string) {
  return tool.startsWith("delete_") || tool === "clear_task_blocks";
}
/** Review label for a step's "before" data. */
export function beforeLabel(tool: string) {
  if (isRemoval(tool)) return "What will be removed";
  if (tool === "undo_schedule") return "Blocks removed and restored";
  if (
    tool === "update_working_hours" ||
    tool === "update_notification_settings"
  )
    return "Current settings";
  return "Existing content";
}

const timestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** Shows ISO timestamps in review details as local date and time. */
export function readableTimestamp(value: string): string | null {
  if (!timestamp.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function stepIcon(tool: string): LucideIcon {
  if (isRemoval(tool)) return Trash2;
  if (tool.includes("notification") || tool === "snooze_reminder") return Bell;
  if (tool === "set_today_focus") return Sun;
  if (tool.includes("focus")) return Timer;
  if (tool === "update_working_hours") return Clock;
  if (tool === "undo_schedule") return Undo2;
  if (tool.includes("sheet")) return Table2;
  if (tool.includes("doc")) return FileText;
  if (tool.includes("event") || tool.includes("schedule")) return CalendarDays;
  if (tool.includes("workspace")) return Layers;
  return FolderKanban;
}
/** App-relative links from a step's stored result, resolved by the assistant. */
export function stepLinks(step: ChatStep): { href: string; label: string }[] {
  const result = step.result;
  // A removed object has nothing left to open.
  if (!result || isRemoval(step.tool)) return [];
  const entries: [string, string][] = [
    ["sheet", "sheets"],
    ["task", "tasks"],
    ["project", "projects"],
    ["doc", "docs"],
    ["event", "events"],
  ];
  const links = entries.flatMap(([key, path]) => {
    const item = result[key] as
      | { id?: string; title?: string; name?: string }
      | undefined;
    return item?.id
      ? [
          {
            href: `/${path}/${item.id}`,
            label: item.title || item.name || `Open ${key}`,
          },
        ]
      : [];
  });
  if (!links.length && typeof result.id === "string") {
    const path = step.tool.includes("sheet_template")
      ? "sheets/templates"
      : step.tool.includes("sheet")
        ? "sheets"
        : step.tool.includes("doc")
          ? "docs"
          : step.tool.includes("project")
            ? "projects"
            : step.tool.includes("event")
              ? "events"
              : step.tool.includes("task")
                ? "tasks"
                : "";
    if (path)
      links.push({
        href: `/${path}/${result.id}`,
        label: String(result.title || result.name || "Open item"),
      });
  }
  return links;
}
export function relativeTime(iso: string, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
export function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  if (day >= start) return "Today";
  if (day >= start - 86400000) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
export type ChatGroup = { label: string; items: Chat[] };
/** Attention first, then recency buckets. */
export function groupChats(chats: Chat[], now = new Date()): ChatGroup[] {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = 86400000;
  const groups: ChatGroup[] = [
    { label: "Needs you", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This week", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const chat of chats) {
    if (chat.status === "approval" || chat.status === "failed") {
      groups[0].items.push(chat);
      continue;
    }
    const at = Date.parse(chat.updatedAt);
    if (at >= start) groups[1].items.push(chat);
    else if (at >= start - day) groups[2].items.push(chat);
    else if (at >= start - 6 * day) groups[3].items.push(chat);
    else groups[4].items.push(chat);
  }
  return groups.filter((g) => g.items.length);
}
