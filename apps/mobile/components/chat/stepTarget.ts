import type { ChatStep } from "../../lib/chat/types";

// What a chat step opens and which icon it gets, kept free of runtime imports
// so `make test-mobile-assistant` can load it with plain Node. chatMeta maps
// the icon kinds onto the icons.

/** Deletions and clearing blocks remove data; their review cards say so. */
export function isRemoval(tool: string) {
  return tool.startsWith("delete_") || tool === "clear_task_blocks";
}

const botTools = new Set([
  "create_bot",
  "update_bot",
  "pause_bot",
  "run_bot_now",
  "ask_bot",
  "preview_bot",
  "get_bot",
  "list_bots",
]);

export type StepIconKind =
  | "remove"
  | "bot"
  | "notification"
  | "task-view"
  | "today"
  | "focus"
  | "undo"
  | "sheet"
  | "doc"
  | "calendar"
  | "workspace"
  | "other";

/** The kind of icon a step's tool gets in review cards. */
export function stepIconKind(tool: string): StepIconKind {
  if (isRemoval(tool)) return "remove";
  if (botTools.has(tool)) return "bot";
  if (tool.includes("notification") || tool === "snooze_reminder")
    return "notification";
  if (tool.includes("task_view")) return "task-view";
  if (tool === "set_today_focus") return "today";
  if (tool.includes("focus")) return "focus";
  if (tool === "undo_schedule") return "undo";
  if (tool.includes("sheet")) return "sheet";
  if (tool.includes("doc") || tool.includes("3d_model")) return "doc";
  if (tool.includes("event") || tool.includes("schedule")) return "calendar";
  if (tool.includes("workspace")) return "workspace";
  return "other";
}

/**
 * Where each ID prefix opens. Server IDs are `<prefix>_<uuid>`, so the kind of
 * object comes from the ID itself, not from guessing at the tool's name.
 * Prefixes without a screen (checklist items, stages, rows) are skipped so the
 * parent's ID is used instead.
 */
const targetKinds: [
  prefix: string,
  noun: string,
  href: (id: string) => string,
][] = [
  ["shtpl_", "template", (id) => `/files/${id}`],
  ["sht_", "sheet", (id) => `/files/${id}`],
  ["doc_", "doc", (id) => `/files/${id}`],
  ["tsk_", "task", (id) => `/tasks/${id}`],
  ["pr_", "project", (id) => `/projects/${id}`],
  ["evt_", "event", (id) => `/events/${id}`],
  ["blk_", "calendar", () => "/calendar"],
  ["ws_", "workspace", () => "/settings/workspaces"],
  ["lbl_", "workspace", () => "/settings/workspaces"],
  ["tst_", "workspace", () => "/settings/workspaces"],
  ["cf_", "workspace", () => "/settings/workspaces"],
  // A bot opens its sheet on the Bots tab.
  ["bot_", "bot", (id) => `/bots?bot=${id}`],
];

const partPrefixes = ["blk_", "lbl_", "tst_", "cf_"];

// Nested result objects first (the object a write returns), then the step's
// own ID fields, then the parents it names.
const nestedKeys = [
  "sheet",
  "task",
  "project",
  "doc",
  "event",
  "workspace",
  "bot",
];
const idKeys = [
  "id",
  "docId",
  "sheetId",
  "taskId",
  "projectId",
  "eventId",
  "workspaceId",
  "botId",
  // update_bot names its bot as `bot` (an id or a name; only an id matches a prefix).
  "bot",
];

/** `title` is the object's own name when the step returned it. */
export type StepTarget = { href: string; title?: string; noun: string };

/**
 * The screen that shows what a finished step changed, from its stored result
 * or, failing that, its arguments. Null when nothing it touched has a screen.
 */
export function stepTarget(step: ChatStep): StepTarget | null {
  const result = step.result ?? {};
  // A saved view opens Tasks with it active, on the app whose views it is
  // (viewsOn); a web and desktop view has nothing to open here.
  const view = result.view as Record<string, unknown> | undefined;
  if (
    view &&
    typeof view === "object" &&
    typeof view.id === "string" &&
    result.viewsOn
  ) {
    if (result.viewsOn !== "phone") return null;
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

/** One target when every finished step changed the same screen, else null. */
export function sharedTarget(steps: ChatStep[]): StepTarget | null {
  const targets = steps.filter((s) => s.status === "done").map(stepTarget);
  const first = targets[0];
  if (!first || targets.some((t) => t?.href !== first.href)) return null;
  return targets.find((t) => t?.title) ?? first;
}
