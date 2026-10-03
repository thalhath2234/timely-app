// Read models computed from the store the way the Go API computes them:
// task relations, GET /calendar items, GET /today buckets, rank, capacity,
// activity feeds and search hits.

import type {
  CalendarEventEntity,
  CalendarItem,
  DayCapacity,
  Label,
  Project,
  RecurrenceRule,
  Stage,
  Task,
  TaskActivity,
  TodayResponse,
  WeekdayKey,
} from "@/app/_types/types";
import type { ProjectActivityEntry } from "@/app/utils/api/projects";
import type { RankedTask } from "@/app/utils/api/schedule";
import type { SearchHit } from "@/app/utils/api/search";
import { rfc3339, ymdOf } from "./clock";
import { allLabels, type Store } from "./store";

const MINUTE = 60_000;
const DAY_KEYS: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export const isInbox = (t: Task) => t.kind === "inbox";
export const isReminder = (t: Task) => t.kind === "reminder";
export const isCompleted = (t: Task) => Boolean(t.completedAt);

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

// ---- Relations

export function projectBase(store: Store, project: Project): Project {
  const workspace = store.workspaces.find((w) => w.id === project.workspaceId) ?? null;
  return {
    ...project,
    status: workspace?.status.find((s) => s.id === project.statusId) ?? null,
    workspace,
  };
}

/** A task as GET /tasks returns it: project, status, workspace, stage, labels and progress attached. */
export function hydrateTask(store: Store, task: Task): Task {
  const workspace = store.workspaces.find((w) => w.id === task.workspaceId) ?? null;
  const project = store.projects.find((p) => p.id === task.projectId);
  const labels = allLabels(store);
  const blocks = [...(task.blocks ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const checklist = task.checklist ?? [];
  const done = checklist.filter((item) => item.completedAt).length;
  return {
    ...task,
    blocks,
    scheduledOn: blocks[0]?.start ?? task.scheduledOn,
    project: project ? projectBase(store, project) : null,
    workspace,
    status: workspace?.status.find((s) => s.id === task.statusId) ?? null,
    stage: store.stages.find((s) => s.id === task.stageId) ?? null,
    labels: (task.labelIds ?? [])
      .map(({ id }) => labels.find((label) => label.id === id))
      .filter((label): label is Label => Boolean(label)),
    checklistDone: done,
    checklistTotal: checklist.length,
    progressDone: done,
    progressTotal: checklist.length,
  };
}

export function stagesOf(store: Store, projectId: string): Stage[] {
  return store.stages.filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);
}

/** GET /projects row: stages and the project's tasks attached. */
export function projectListItem(store: Store, project: Project): Project {
  return {
    ...projectBase(store, project),
    stages: stagesOf(store, project.id),
    tasks: store.tasks.filter((t) => t.projectId === project.id).map((t) => hydrateTask(store, t)),
  };
}

/** GET /projects/:id: stages carry their tasks; `tasks` holds the unstaged ones. */
export function projectDetail(store: Store, project: Project): Project {
  const tasks = store.tasks.filter((t) => t.projectId === project.id).map((t) => hydrateTask(store, t));
  const stages: (Stage & { tasks: Task[] })[] = stagesOf(store, project.id).map((stage) => ({
    ...stage,
    tasks: tasks.filter((t) => t.stageId === stage.id),
  }));
  return { ...projectBase(store, project), stages, tasks: tasks.filter((t) => !t.stageId) };
}

// ---- Recurrence (weekly BYDAY rules are all the sample uses)

type Occurrence = { start: Date; end: Date };

function expandWeekly(rule: RecurrenceRule, minutes: number, from: Date, to: Date): Occurrence[] {
  const byday = /BYDAY=([A-Z,]+)/.exec(rule.rrule)?.[1]?.split(",") ?? [];
  const weekdays = new Set(byday.map((d) => RRULE_DAYS.indexOf(d)).filter((d) => d >= 0));
  const anchor = new Date(rule.dtstart);
  const cancelled = new Set((rule.exceptions ?? []).filter((e) => e.isCancelled).map((e) => Date.parse(e.originalStart)));
  const out: Occurrence[] = [];
  for (let day = addDays(startOfDay(from), -1); day < to; day = addDays(day, 1)) {
    if (!weekdays.has(day.getDay()) || day < startOfDay(anchor)) continue;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), anchor.getHours(), anchor.getMinutes());
    const end = new Date(start.getTime() + minutes * MINUTE);
    if (cancelled.has(start.getTime())) continue;
    const overlaps = minutes > 0 ? start < to && end > from : start >= from && start < to;
    if (overlaps) out.push({ start, end });
  }
  return out;
}

// ---- GET /calendar

function taskColor(store: Store, task: Task) {
  const project = store.projects.find((p) => p.id === task.projectId);
  if (project?.color) return project.color;
  return store.workspaces.find((w) => w.id === task.workspaceId)?.color ?? "#889096";
}

export function calendarItems(store: Store, from: Date, to: Date): CalendarItem[] {
  const items: CalendarItem[] = [];

  for (const raw of store.tasks) {
    if (isInbox(raw)) continue;
    const task = hydrateTask(store, raw);
    const color = taskColor(store, raw);
    const base = { title: task.name, allDay: false, color, taskId: task.id, task, chunkIndex: 0, chunkCount: 0 };

    if (task.recurrence?.rrule) {
      const minutes = isReminder(task) ? 0 : task.duration;
      for (const occurrence of expandWeekly(task.recurrence, minutes, from, to)) {
        items.push({
          ...base,
          id: `${task.id}@${rfc3339(occurrence.start)}`,
          kind: "taskOccurrence",
          start: occurrence.start.toISOString(),
          end: occurrence.end.toISOString(),
          seriesId: task.recurrence.id,
          originalStart: occurrence.start.toISOString(),
          moved: false,
          reminder: isReminder(task),
        });
      }
      continue;
    }

    if (isReminder(task)) {
      if (!task.scheduledOn) continue;
      const at = new Date(task.scheduledOn);
      if (at >= from && at < to) {
        items.push({ ...base, id: `${task.id}@reminder`, kind: "task", start: task.scheduledOn, end: task.scheduledOn, reminder: true });
      }
      continue;
    }

    const blocks = task.blocks ?? [];
    for (const block of blocks) {
      if (!(new Date(block.start) < to && new Date(block.end) > from)) continue;
      items.push({
        ...base,
        id: block.id,
        kind: "task",
        start: block.start,
        end: block.end,
        blockId: block.id,
        source: block.source,
        chunkIndex: block.chunkIndex,
        chunkCount: blocks.length,
      });
    }
  }

  for (const event of store.events) {
    const base = {
      title: event.title,
      allDay: event.allDay,
      color: event.color,
      eventId: event.id,
      event,
      chunkIndex: 0,
      chunkCount: 0,
    };
    const minutes = event.allDay ? 24 * 60 : Math.round((Date.parse(event.end) - Date.parse(event.start)) / MINUTE);
    if (event.recurrence?.rrule) {
      for (const occurrence of expandWeekly(event.recurrence, minutes, from, to)) {
        items.push({
          ...base,
          id: `${event.id}@${rfc3339(occurrence.start)}`,
          kind: "eventOccurrence",
          start: occurrence.start.toISOString(),
          end: occurrence.end.toISOString(),
          seriesId: event.recurrence.id,
          originalStart: occurrence.start.toISOString(),
          moved: false,
        });
      }
      continue;
    }
    const start = event.allDay ? startOfDay(new Date(event.start)) : new Date(event.start);
    const end = event.allDay ? addDays(start, 1) : new Date(event.end);
    if (!(start < to && end > from)) continue;
    items.push({ ...base, id: event.id, kind: "event", start: start.toISOString(), end: end.toISOString() });
  }

  return items.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

// ---- GET /today

function blockOnDay(task: Task, dayStart: Date, dayEnd: Date) {
  const onDay = (task.blocks ?? []).some((b) => new Date(b.end) >= dayStart && new Date(b.start) < dayEnd);
  if (onDay) return true;
  if (!task.scheduledOn) return false;
  const at = new Date(task.scheduledOn);
  return at >= dayStart && at < dayEnd;
}

export function today(store: Store, date: string | null, timezone: string | null): TodayResponse {
  const { clock } = store;
  const dayStart = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : clock.today0;
  const dayEnd = addDays(dayStart, 1);
  const dayStamp = ymdOf(dayStart);
  const tomorrowStamp = ymdOf(dayEnd);
  const items = calendarItems(store, dayStart, dayEnd);
  const scheduled = new Set(items.filter((i) => i.taskId && !i.reminder).map((i) => i.taskId));

  const out: TodayResponse = {
    date: dayStamp,
    timezone: timezone || store.config.workingHours?.timezone || "UTC",
    focusing: null,
    todayFocus: [],
    items,
    overdue: [],
    unscheduled: [],
    inboxCount: 0,
    completedToday: [],
    unfinished: [],
    tomorrowFocus: [],
  };
  for (const raw of store.tasks) {
    const task = hydrateTask(store, raw);
    if (isInbox(task)) out.inboxCount += 1;
    if (task.focusStartedAt) out.focusing = task;
    if (task.todayFocusOn === dayStamp) out.todayFocus.push(task);
    if (task.todayFocusOn === tomorrowStamp) out.tomorrowFocus.push(task);
    if (task.completedAt && ymdOf(new Date(task.completedAt)) === dayStamp) {
      out.completedToday.push(task);
      continue;
    }
    if (isCompleted(task) || isInbox(task) || isReminder(task)) continue;
    if (task.deadline && task.deadline < dayStamp) out.overdue.push(task);
    if (!blockOnDay(task, dayStart, dayEnd)) out.unscheduled.push(task);
    if (scheduled.has(task.id)) out.unfinished.push(task);
  }
  return out;
}

// ---- GET /schedule/rank (same policy as features/schedule/ranking.go)

export function rank(store: Store): RankedTask[] {
  const { clock } = store;
  const todayStamp = clock.ymd(0);
  const dayEnd = addDays(clock.today0, 1);
  const list: RankedTask[] = [];
  for (const raw of store.tasks) {
    if (isInbox(raw) || isReminder(raw) || isCompleted(raw)) continue;
    const unscheduled = !blockOnDay(raw, clock.today0, dayEnd);
    const overdue = Boolean(raw.deadline && raw.deadline < todayStamp);
    if (!unscheduled && !overdue) continue;

    let score = 0;
    const reasons: string[] = [];
    const blocker = raw.blockedById ? store.tasks.find((t) => t.id === raw.blockedById) : undefined;
    if (blocker && !isCompleted(blocker)) {
      score -= 80;
      reasons.push("waiting on another task");
    }
    if (raw.deadline) {
      const slack = Math.round((new Date(`${raw.deadline}T00:00:00`).getTime() - clock.today0.getTime()) / (24 * 60 * MINUTE));
      if (slack < 0) {
        score += 100;
        reasons.push("overdue");
      } else if (slack === 0) {
        score += 50;
        reasons.push("due today");
      } else {
        const boost = Math.max(0, 40 - slack * 4);
        score += boost;
        if (boost > 0) reasons.push(`due in ${slack} days`);
      }
    }
    const priority = (raw.priorityLevel ?? "").toLowerCase();
    if (priority === "urgent") {
      score += 40;
      reasons.push("urgent");
    } else if (priority === "high") {
      score += 25;
      reasons.push("high priority");
    } else if (priority === "medium") {
      score += 10;
      reasons.push("medium priority");
    }
    if (raw.todayFocusOn === todayStamp) {
      score += 35;
      reasons.push("in Today focus");
    }
    if (unscheduled) {
      score += 5;
      reasons.push("unscheduled");
    }
    if ((raw.actualMinutes ?? 0) > 0 && raw.duration > 0) {
      score += 8;
      reasons.push("already started");
    }
    if (reasons.length === 0) reasons.push("open work");
    list.push({ task: hydrateTask(store, raw), score, reasons });
  }
  return list.sort((a, b) => b.score - a.score);
}

// ---- GET /schedule/capacity

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function capacity(store: Store, from: Date, to: Date): DayCapacity[] {
  const days: DayCapacity[] = [];
  const windows = store.config.workingHours?.days ?? {};
  for (let day = startOfDay(from); day < to && days.length < 62; day = addDays(day, 1)) {
    const next = addDays(day, 1);
    const working = (windows[DAY_KEYS[day.getDay()]] ?? []).reduce((sum, w) => sum + minutesOf(w.end) - minutesOf(w.start), 0);
    const items = calendarItems(store, day, next);
    const meetings = items
      .filter((i) => (i.kind === "event" || i.kind === "eventOccurrence") && !i.allDay)
      .reduce((sum, i) => sum + (Date.parse(i.end) - Date.parse(i.start)) / MINUTE, 0);
    const blocked = items.some((i) => i.allDay);
    const scheduledMinutes = items
      .filter((i) => i.blockId && !i.reminder)
      .reduce((sum, i) => sum + (Date.parse(i.end) - Date.parse(i.start)) / MINUTE, 0);
    const availableMinutes = blocked ? 0 : Math.max(0, working - meetings);
    days.push({
      date: ymdOf(day),
      availableMinutes,
      scheduledMinutes,
      plannedMinutes: scheduledMinutes,
      overCapacity: scheduledMinutes > availableMinutes && availableMinutes > 0,
      atRisk: availableMinutes > 0 && availableMinutes - scheduledMinutes < 45,
    });
  }
  return days;
}

// ---- Activity

function taskHistory(store: Store, task: Task): TaskActivity[] {
  const entry = (suffix: string, action: TaskActivity["action"], message: string, createdAt: string, field?: string, oldValue?: string, newValue?: string): TaskActivity => ({
    id: `act_${task.id}_${suffix}`,
    taskId: task.id,
    userId: task.userId,
    actorName: "Maya Chen",
    action,
    field: field ?? null,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    message,
    createdAt,
  });
  const out: TaskActivity[] = [entry("created", "created", "created this task", task.createdAt)];
  const status = hydrateTask(store, task).status?.name;
  if (task.blocks?.length) {
    out.push(entry("scheduled", "updated", "scheduled this task", task.blocks[0].start < task.createdAt ? task.createdAt : addMinutesIso(task.createdAt, 3), "scheduledOn"));
  }
  if (status && status !== "Todo" && status !== "Backlog") {
    const at = task.completedAt ?? (task.updatedAt > task.createdAt ? task.updatedAt : addMinutesIso(task.createdAt, 60 * 24));
    out.push(entry("status", "updated", `changed status from Todo to ${status}`, at, "status", "Todo", status));
  }
  if (task.priorityLevel === "Urgent") {
    out.push(entry("priority", "updated", "changed priority from High to Urgent", addMinutesIso(task.createdAt, 60 * 30), "priority", "High", "Urgent"));
  }
  out.push(...store.comments.filter((c) => c.taskId === task.id));
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function addMinutesIso(value: string, minutes: number) {
  return new Date(Date.parse(value) + minutes * MINUTE).toISOString();
}

export function taskActivity(store: Store, taskId: string): TaskActivity[] | undefined {
  const task = store.tasks.find((t) => t.id === taskId);
  return task ? taskHistory(store, task) : undefined;
}

export function projectActivity(store: Store, projectId: string): ProjectActivityEntry[] | undefined {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return undefined;
  const entries: ProjectActivityEntry[] = store.tasks
    .filter((t) => t.projectId === projectId)
    .flatMap((task) =>
      taskHistory(store, task).map((a) => ({
        id: a.id,
        taskId: task.id,
        taskName: task.name,
        actorName: a.actorName,
        action: a.action,
        field: a.field ?? null,
        oldValue: a.oldValue ?? null,
        newValue: a.newValue ?? null,
        message: a.message,
        createdAt: a.createdAt,
      })),
    );
  entries.push({
    id: `act_${project.id}_created`,
    taskId: "",
    taskName: "",
    actorName: "Maya Chen",
    action: "created",
    field: null,
    oldValue: null,
    newValue: null,
    message: "created this project",
    createdAt: project.createdAt,
  });
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}

// ---- GET /search

function snippet(content: string, words: string[]) {
  const flat = content.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const index = Math.max(0, Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), flat.length));
  const start = Math.max(0, index - 40);
  const cut = flat.slice(start, start + 140);
  return `${start > 0 ? "…" : ""}${cut}${start + 140 < flat.length ? "…" : ""}`;
}

export function search(store: Store, query: string): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const sheetText = (rows: { cells: Record<string, string> }[]) =>
    rows.flatMap((r) => Object.values(r.cells)).filter((v) => v && !v.startsWith("=")).join(" · ");
  const docs: { kind: SearchHit["kind"]; id: string; title: string; content: string }[] = [
    ...store.tasks.filter((t) => !isInbox(t)).map((t) => ({ kind: "task", id: t.id, title: t.name, content: t.description })),
    ...store.projects.map((p) => ({ kind: "project", id: p.id, title: p.title, content: p.description ?? "" })),
    ...store.docs.filter((d) => !d.archivedAt).map((d) => ({ kind: "doc", id: d.id, title: d.title, content: d.plainText })),
    ...store.sheets.filter((s) => !s.archivedAt).map((s) => ({
      kind: "sheet",
      id: s.id,
      title: s.title,
      content: sheetText((s.tabs?.length ? s.tabs : [s]).flatMap((tab) => tab.rows)),
    })),
    ...store.events.map((e: CalendarEventEntity) => ({ kind: "event", id: e.id, title: e.title, content: e.description })),
  ];
  return docs
    .map((d) => {
      const title = d.title.toLowerCase();
      const body = d.content.toLowerCase();
      if (!words.every((w) => title.includes(w) || body.includes(w))) return null;
      const titleHits = words.filter((w) => title.includes(w)).length;
      const score = Number((0.4 + (0.5 * titleHits) / words.length + (body.includes(words[0]) ? 0.1 : 0)).toFixed(3));
      const inBody = words.some((w) => body.includes(w));
      return {
        kind: d.kind,
        id: d.id,
        title: d.title,
        snippet: inBody ? snippet(d.content, words) : d.content.slice(0, 140),
        score,
        content: d.content,
      } satisfies SearchHit;
    })
    .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 20);
}
