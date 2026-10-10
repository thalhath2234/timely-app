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
  History,
  Layers,
  ListFilter,
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
import type { Chat, ChatStep, ChatSummary } from "@/app/utils/api/chat";
import { fileHref } from "@/app/utils/fileRoutes";

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
    case "choose":
      return {
        label: "Choose where to continue",
        tone: "warning",
        icon: History,
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
  if (tool.includes("task_view")) return ListFilter;
  if (tool === "set_today_focus") return Sun;
  if (tool.includes("focus")) return Timer;
  if (tool === "undo_schedule") return Undo2;
  if (tool.includes("sheet")) return Table2;
  if (tool.includes("doc") || tool.includes("3d_model")) return FileText;
  if (tool.includes("event") || tool.includes("schedule")) return CalendarDays;
  if (tool.includes("workspace")) return Layers;
  return FolderKanban;
}

/**
 * Where each ID prefix opens. Server IDs are `<prefix>_<uuid>`, so the kind of
 * object comes from the ID itself, not from guessing at the tool's name.
 * Prefixes without a page (checklist items, stages, rows) are skipped so the
 * parent's ID is used instead.
 */
const targetKinds: [
  prefix: string,
  noun: string,
  href: (id: string) => string,
][] = [
  ["shtpl_", "template", (id) => fileHref(id)],
  ["sht_", "sheet", (id) => fileHref(id)],
  ["doc_", "doc", (id) => fileHref(id)],
  ["tsk_", "task", (id) => `/tasks?taskId=${id}`],
  ["pr_", "project", (id) => `/projects/${id}`],
  ["evt_", "event", () => "/calendar"],
  ["blk_", "calendar", () => "/calendar"],
  ["ws_", "workspace", () => "/settings?tab=workspaces"],
  ["lbl_", "workspace", () => "/settings?tab=workspaces"],
  ["tst_", "workspace", () => "/settings?tab=workspaces"],
  ["cf_", "workspace", () => "/settings?tab=workspaces"],
];

const partPrefixes = ["blk_", "lbl_", "tst_", "cf_"];

// Nested result objects first (the object a write returns), then the step's
// own ID fields, then the parents it names.
const nestedKeys = ["sheet", "task", "project", "doc", "event", "workspace"];
const idKeys = [
  "id",
  "docId",
  "sheetId",
  "taskId",
  "projectId",
  "eventId",
  "workspaceId",
];

/** `title` is the object's own name when the step returned it. */
export type StepTarget = { href: string; title?: string; noun: string };

/**
 * The page that shows what a finished step changed, from its stored result or,
 * failing that, its arguments. Null when nothing it touched has a page.
 */
export function stepTarget(step: ChatStep): StepTarget | null {
  const result = step.result ?? {};
  // A saved view opens Tasks with it active, on the app whose views it is
  // (viewsOn); a phone view has nothing to open here.
  const view = result.view as Record<string, unknown> | undefined;
  if (view && typeof view === "object" && typeof view.id === "string" && result.viewsOn) {
    if (result.viewsOn !== "web") return null;
    return {
      href: `/tasks?view=${encodeURIComponent(view.id)}`,
      title: typeof view.name === "string" ? view.name : undefined,
      noun: "view",
    };
  }
  const sources: Record<string, unknown>[] = [];
  for (const key of nestedKeys) {
    const item = result[key];
    if (item && typeof item === "object")
      sources.push(item as Record<string, unknown>);
  }
  sources.push(result, step.arguments ?? {});
  for (const source of sources) {
    for (const key of idKeys) {
      const id = source[key];
      if (typeof id !== "string") continue;
      const kind = targetKinds.find(([prefix]) => id.startsWith(prefix));
      if (!kind) continue;
      const [, noun, href] = kind;
      // A title only names the object when it came from the same record, and
      // not for parts shown on another page (a label opens its workspace).
      const named =
        key === "id" && !partPrefixes.includes(kind[0])
          ? source.title || source.name
          : "";
      return {
        href: href(encodeURIComponent(id)),
        title: named ? String(named) : undefined,
        noun,
      };
    }
  }
  return null;
}

/** One target when every finished step changed the same page, else null. */
export function sharedTarget(steps: ChatStep[]): StepTarget | null {
  const targets = steps.filter((s) => s.status === "done").map(stepTarget);
  const first = targets[0];
  if (!first || targets.some((t) => t?.href !== first.href)) return null;
  return targets.find((t) => t?.title) ?? first;
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
    if (["approval", "choose", "failed"].includes(chat.status)) {
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

/** Notes smart suggestions left on the proposal waiting for review. */
export function reviewNotes(chat: Chat): string[] {
  if (chat.status !== "approval") return [];
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m.proposal) return m.notes ?? [];
    if (m.role === "user" && !m.kind) return [];
  }
  return [];
}
