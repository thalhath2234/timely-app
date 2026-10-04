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
  LoaderCircle,
  MapPin,
  MousePointerSquareDashed,
  Search,
  Sun,
  Table2,
  TextSelect,
  Timer,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { ChatStep, ChatSummary } from "@/app/utils/api/chat";

/** Context chips carry a kind from the client that attached them. */
export const chipIcons: Record<string, LucideIcon> = {
  location: MapPin,
  object: FileText,
  workspace: Layers,
  project: FolderKanban,
  selection: TextSelect,
  "sheet-tab": Table2,
  calendar: CalendarDays,
  today: Sun,
  search: Search,
  tasks: MousePointerSquareDashed,
};
export function chipIcon(kind: string): LucideIcon {
  return chipIcons[kind] || MapPin;
}

export const busyStatuses = ["queued", "running"];
export function isBusy(status?: string) {
  return !!status && busyStatuses.includes(status);
}

export function statusMeta(status: string): {
  label: string;
  tone: "primary" | "warning" | "destructive" | "muted";
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
): { label: string; icon: LucideIcon; className: string; spin?: boolean } {
  if (status === "done")
    return {
      label: "Done",
      icon: Check,
      className: "bg-success/15 text-success",
    };
  if (status === "failed")
    return {
      label: "Failed",
      icon: AlertTriangle,
      className: "bg-destructive/15 text-destructive",
    };
  if (status === "discarded")
    return {
      label: "Discarded",
      icon: Ban,
      className: "bg-muted text-muted-foreground",
    };
  if (active)
    return {
      label: "In progress",
      icon: LoaderCircle,
      className: "bg-primary/15 text-primary",
      spin: true,
    };
  return {
    label: "Pending",
    icon: Circle,
    className: "bg-muted text-muted-foreground",
  };
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

/** Links created or edited objects from a step's stored result. */
export function stepTarget(
  step: ChatStep,
): { href: string; title: string } | null {
  const result = step.result;
  // A removed object has nothing left to open.
  if (!result || isRemoval(step.tool)) return null;
  for (const [key, path] of [
    ["sheet", "sheets"],
    ["task", "tasks"],
    ["project", "projects"],
    ["doc", "docs"],
    ["event", "calendar"],
    ["workspace", "workspaces"],
  ] as const) {
    const item = result[key] as Record<string, unknown> | undefined;
    if (typeof item?.id === "string")
      return {
        href:
          key === "task"
            ? `/tasks?taskId=${encodeURIComponent(item.id)}`
            : key === "event"
              ? "/calendar"
              : key === "workspace"
                ? "/settings?tab=workspaces"
                : `/${path}/${encodeURIComponent(item.id)}`,
        title: String(item.title || item.name || `Open ${key}`),
      };
  }
  if (typeof result.id === "string") {
    const kind = step.tool.includes("sheet_template")
      ? "sheets/templates"
      : step.tool.includes("sheet")
        ? "sheets"
        : step.tool.includes("doc")
          ? "docs"
          : step.tool.includes("project")
            ? "projects"
            : step.tool.includes("event")
              ? "calendar"
              : step.tool.includes("task")
                ? "tasks"
                : "";
    if (kind)
      return {
        href:
          kind === "calendar"
            ? "/calendar"
            : kind === "tasks"
              ? `/tasks?taskId=${encodeURIComponent(result.id)}`
              : `/${kind}/${encodeURIComponent(result.id)}`,
        title: String(result.title || result.name || "Open item"),
      };
  }
  return null;
}

export function relativeTime(iso: string, now = Date.now()) {
  const diff = now - Date.parse(iso);
  const minutes = Math.round(diff / 60000);
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

type Group = { label: string; items: ChatSummary[] };
/** Attention first, then recency buckets, mirroring the notifications page. */
export function groupChats(chats: ChatSummary[], now = new Date()): Group[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 86400000;
  const groups: Group[] = [
    { label: "Needs you", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This week", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const chat of chats) {
    if (["approval", "failed"].includes(chat.status)) {
      groups[0].items.push(chat);
      continue;
    }
    const at = Date.parse(chat.updatedAt);
    if (at >= start.getTime()) groups[1].items.push(chat);
    else if (at >= start.getTime() - day) groups[2].items.push(chat);
    else if (at >= start.getTime() - 6 * day) groups[3].items.push(chat);
    else groups[4].items.push(chat);
  }
  return groups.filter((g) => g.items.length);
}
