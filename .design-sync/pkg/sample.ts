import type {
  CalendarEventEntity,
  Config,
  CustomFieldValueInput,
  Doc,
  DocContent,
  RecurrenceInput,
  RecurrenceRule,
  ScheduledBlock,
  Sheet,
  Stage,
  Task,
  TaskActivity,
  TaskCustomFieldValue,
} from "@/app/_types/types";
import type { Chat, ChatSummary } from "@/app/utils/api/chat";
import type { MockRequest, TimelyMockApi } from "./mockApi";
import { providerModels, buildJobHealth } from "./sample/account";
import { plainOf } from "./sample/content";
import {
  calendarItems,
  capacity,
  hydrateTask,
  isInbox,
  isReminder,
  projectActivity,
  projectDetail,
  projectListItem,
  rank,
  search,
  taskActivity,
  today,
} from "./sample/derive";
import { makeTask } from "./sample/tasks";
import { createStore, nextId, type Store } from "./sample/store";
import { statusId } from "./sample/workspace";
import type { ProviderId } from "@/app/utils/api/agentProviders";
import { sampleImageBlob } from "./sample/image";

type Body = Record<string, unknown>;

const bodyOf = (req: MockRequest): Body =>
  req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Body) : {};

const nowIso = () => new Date().toISOString();

/** Assigns loosely-typed request fields onto a typed record. */
function assign<T extends object>(target: T, key: string, value: unknown) {
  (target as Record<string, unknown>)[key] = value;
}

function parseDate(value: string | null, fallback: Date) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
}

// ---- Task writes

const NULLABLE_TASK_FIELDS = new Set([
  "deadline",
  "startDate",
  "scheduledOn",
  "completedAt",
  "projectId",
  "statusId",
  "priorityLevel",
  "stageId",
  "blockedById",
  "workspaceId",
  "todayFocusOn",
  "earliestStartAt",
]);

function recurrenceRule(input: RecurrenceInput, ownerType: "task" | "event", ownerId: string): RecurrenceRule {
  return { id: `rr_${ownerId}`, ownerType, ownerId, rrule: input.rrule, dtstart: input.dtstart, timezone: input.timezone, exceptions: [] };
}

function customFieldValues(store: Store, taskId: string, inputs: CustomFieldValueInput[], existing: TaskCustomFieldValue[]) {
  const fields = store.workspaces.flatMap((w) => w.customFields);
  const byField = new Map(existing.map((v) => [v.customFieldId, v]));
  for (const input of inputs) {
    const field = fields.find((f) => f.id === input.id);
    if (!field) continue;
    const options = (input.optionsValue ?? [])
      .map(({ id }) => field.options.options.find((o) => o.id === id))
      .filter((o): o is NonNullable<typeof o> => Boolean(o));
    const empty = options.length === 0 && !input.stringValue;
    if (empty) {
      byField.delete(field.id);
      continue;
    }
    const at = nowIso();
    byField.set(field.id, {
      id: `cfv_${taskId}_${field.id}`,
      customFieldValueId: `cfv_${taskId}_${field.id}`,
      customFieldId: field.id,
      taskId,
      name: field.name,
      type: field.type,
      ...(options.length ? { optionValue: options } : { stringValue: input.stringValue }),
      createdAt: byField.get(field.id)?.createdAt ?? at,
      updatedAt: at,
    });
  }
  return [...byField.values()];
}

function applyTaskUpdate(store: Store, task: Task, body: Body) {
  for (const [key, value] of Object.entries(body)) {
    if (key === "customFieldValues" && Array.isArray(value)) {
      task.customFieldValues = customFieldValues(store, task.id, value as CustomFieldValueInput[], task.customFieldValues ?? []);
    } else if (key === "recurrence") {
      task.recurrence = value ? recurrenceRule(value as RecurrenceInput, "task", task.id) : null;
    } else if (NULLABLE_TASK_FIELDS.has(key)) {
      assign(task, key, value === "" || value == null ? null : value);
    } else {
      assign(task, key, value);
    }
  }
  if (task.projectId && !("workspaceId" in body)) {
    task.workspaceId = store.projects.find((p) => p.id === task.projectId)?.workspaceId ?? task.workspaceId;
  }
  // Checking a task off moves it to the workspace's Completed status, and back.
  if ("completedAt" in body && !("statusId" in body) && task.workspaceId) {
    task.statusId = statusId(task.workspaceId, task.completedAt ? "completed" : "todo");
  }
  task.updatedAt = nowIso();
  return task;
}

function createTask(store: Store, body: Body, kind?: Task["kind"]) {
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled task";
  const duration = typeof body.duration === "number" ? body.duration : 0;
  const task = makeTask(store.clock, {
    id: nextId(store, "tsk"),
    name,
    kind: kind ?? (body.kind as Task["kind"] | undefined) ?? (duration > 0 ? "task" : "reminder"),
    createdAt: nowIso(),
    userId: store.user.id,
  });
  const { name: _name, kind: _kind, ...rest } = body;
  void _name;
  void _kind;
  applyTaskUpdate(store, task, rest);
  if (task.workspaceId && !task.statusId && task.kind === "task") task.statusId = statusId(task.workspaceId, "todo");
  store.tasks.unshift(task);
  return task;
}

// ---- Routes

/** Sample workspace served by TimelyProvider's mock API: Maya Chen, a product
 *  designer planning her week. Dates are relative to when this is called. */
export function sampleApi(): TimelyMockApi {
  const store = createStore();
  const { clock } = store;

  const findTask = (id: string) => store.tasks.find((t) => t.id === id);
  const taskOut = (id: string) => {
    const task = findTask(id);
    return task ? hydrateTask(store, task) : undefined;
  };
  /** Runs `fn` on the task and answers `{ task }` like the Go handlers. */
  const withTask = (fn: (task: Task, req: MockRequest) => void) => (req: MockRequest) => {
    const task = findTask(req.params.id);
    if (!task) return undefined;
    fn(task, req);
    task.updatedAt = nowIso();
    return { task: hydrateTask(store, task) };
  };
  const findBlock = (id: string) => {
    for (const task of store.tasks) {
      const block = task.blocks?.find((b) => b.id === id);
      if (block) return { task, block };
    }
    return null;
  };
  const projectOut = (id: string) => {
    const project = store.projects.find((p) => p.id === id);
    return project ? projectDetail(store, project) : undefined;
  };
  const summary = (chat: Chat): ChatSummary => ({
    id: chat.id,
    title: chat.title,
    status: chat.status,
    phase: chat.phase,
    webSearch: chat.webSearch,
    revision: chat.revision,
    unread: chat.unread,
    error: chat.error,
    updatedAt: chat.updatedAt,
    createdAt: chat.createdAt,
  });
  const visibleNotifications = () =>
    store.notifications.filter((n) => !n.snoozedUntil || Date.parse(n.snoozedUntil) <= Date.now());

  const routes: Record<string, (req: MockRequest) => unknown> = {
    // ---- Account
    "GET /me": () => store.user,
    "PUT /me": (req) => {
      const body = bodyOf(req);
      if (typeof body.name === "string") store.user.name = body.name;
      if (typeof body.email === "string") store.user.email = body.email;
      return store.user;
    },
    "GET /sessions": () => store.sessions,
    "DELETE /sessions/others": () => {
      const revoked = store.sessions.filter((s) => !s.current).length;
      store.sessions = store.sessions.filter((s) => s.current);
      return { revoked };
    },
    "DELETE /sessions/:id": (req) => {
      store.sessions = store.sessions.filter((s) => s.id !== req.params.id);
      return { message: "session revoked" };
    },
    "POST /auth/refresh": () => ({ token: "" }),
    "GET /api-keys": () => store.apiKeys,
    "POST /api-keys": (req) => {
      const name = String(bodyOf(req).name ?? "New key");
      const key = { id: nextId(store, "key"), userId: store.user.id, name, prefix: "tml_Xa4n", lastUsedAt: null, createdAt: nowIso() };
      store.apiKeys.unshift(key);
      return { ...key, key: "tml_Xa4n_sample-key-shown-once" };
    },
    "DELETE /api-keys/:id": (req) => {
      store.apiKeys = store.apiKeys.filter((k) => k.id !== req.params.id);
      return { message: "api key revoked" };
    },
    "GET /backups": () => ({ items: store.backups }),
    "POST /backups": () => {
      const backup = { id: nextId(store, "bak"), byteSize: 2_490_112, checksum: "a83e5b0c1d97", createdAt: nowIso() };
      store.backups.unshift(backup);
      return backup;
    },
    "DELETE /backups/:id": (req) => {
      store.backups = store.backups.filter((b) => b.id !== req.params.id);
      return { message: "backup deleted" };
    },
    "GET /backups/settings": () => store.backupSettings,
    "PUT /backups/settings": (req) => Object.assign(store.backupSettings, bodyOf(req)),

    // ---- Config & workspaces
    "GET /config": () => ({ ...store.config, customFields: store.workspaces.flatMap((w) => w.customFields) }),
    "PUT /config": (req) => {
      const body = bodyOf(req);
      const config: Config = store.config;
      if (Array.isArray(body.taskViews)) config.taskViews = body.taskViews as Config["taskViews"];
      if (typeof body.activeTaskViewId === "string") config.activeTaskViewId = body.activeTaskViewId;
      if (body.projectTaskViews && typeof body.projectTaskViews === "object") config.projectTaskViews = body.projectTaskViews as Config["projectTaskViews"];
      if (body.appearance && typeof body.appearance === "object") config.appearance = body.appearance as Config["appearance"];
      if (typeof body.isOnboardingCompleted === "boolean") config.isOnBoardingCompleted = body.isOnboardingCompleted;
      config.updatedAt = nowIso();
      return config;
    },
    "GET /workspaces": () => store.workspaces,
    "GET /workspaces/:id": (req) => store.workspaces.find((w) => w.id === req.params.id),

    // ---- Tasks
    "GET /tasks": (req) => {
      const q = req.query;
      const kind = (q.get("kind") ?? "").toLowerCase();
      const flag = (name: string) => q.get(name) === "true" || q.get(name) === "1";
      let tasks = store.tasks.filter((t) => {
        if (flag("inbox") || kind === "inbox") return isInbox(t);
        if (flag("reminders") || kind === "reminder") return isReminder(t);
        if (kind === "task") return t.kind === "task";
        return !isInbox(t) && !isReminder(t);
      });
      const ids = (name: string) => q.getAll(name).filter(Boolean);
      const pick = (name: string, field: (t: Task) => string | null) => {
        const wanted = ids(name);
        if (wanted.length) tasks = tasks.filter((t) => wanted.includes(field(t) ?? ""));
      };
      pick("workspaceId", (t) => t.workspaceId);
      pick("projectId", (t) => t.projectId);
      pick("statusId", (t) => t.statusId);
      if (q.get("completed") === "true") tasks = tasks.filter((t) => t.completedAt);
      if (q.get("completed") === "false") tasks = tasks.filter((t) => !t.completedAt);
      const text = (q.get("q") ?? "").toLowerCase();
      if (text) tasks = tasks.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(text));
      const offset = Number(q.get("offset") ?? 0) || 0;
      const limit = Number(q.get("limit") ?? 200) || 200;
      return tasks.slice(offset, offset + limit).map((t) => hydrateTask(store, t));
    },
    "GET /task/:id": (req) => taskOut(req.params.id),
    "GET /tasks/:id": (req) => taskOut(req.params.id),
    "POST /tasks": (req) => ({ task: hydrateTask(store, createTask(store, bodyOf(req))) }),
    "PUT /tasks/:id": withTask((task, req) => applyTaskUpdate(store, task, bodyOf(req))),
    "DELETE /tasks/:id": (req) => {
      if (!findTask(req.params.id)) return undefined;
      store.tasks = store.tasks.filter((t) => t.id !== req.params.id);
      return { message: "task deleted" };
    },
    "PATCH /tasks/bulk": (req) => {
      const body = bodyOf(req);
      const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
      const update = (body.update && typeof body.update === "object" ? body.update : {}) as Body;
      const tasks = store.tasks.filter((t) => ids.includes(t.id)).map((t) => hydrateTask(store, applyTaskUpdate(store, t, update)));
      return { tasks };
    },
    "POST /tasks/:id/duplicate": (req) => {
      const source = findTask(req.params.id);
      if (!source) return undefined;
      const copy: Task = { ...structuredClone(source), id: nextId(store, "tsk"), name: `${source.name} (copy)`, blocks: [], completedAt: null, createdAt: nowIso(), updatedAt: nowIso() };
      store.tasks.unshift(copy);
      return { task: hydrateTask(store, copy) };
    },
    "GET /tasks/:id/activity": (req) => taskActivity(store, req.params.id),
    "POST /tasks/:id/activity": (req) => {
      if (!findTask(req.params.id)) return undefined;
      const entry: TaskActivity = {
        id: nextId(store, "act"),
        taskId: req.params.id,
        userId: store.user.id,
        actorName: store.user.name ?? "Maya Chen",
        action: "commented",
        message: String(bodyOf(req).comment ?? ""),
        createdAt: nowIso(),
      };
      store.comments.push(entry);
      return entry;
    },
    "POST /tasks/:id/checklist": withTask((task, req) => {
      const items = task.checklist ?? [];
      items.push({ id: nextId(store, "chk"), title: String(bodyOf(req).title ?? ""), completedAt: null, order: items.length });
      task.checklist = items;
    }),
    "PATCH /tasks/:id/checklist/:itemId": withTask((task, req) => {
      const item = task.checklist?.find((i) => i.id === req.params.itemId);
      const body = bodyOf(req);
      if (!item) return;
      if (typeof body.title === "string") item.title = body.title;
      if (typeof body.completed === "boolean") item.completedAt = body.completed ? nowIso() : null;
    }),
    "DELETE /tasks/:id/checklist/:itemId": withTask((task, req) => {
      task.checklist = (task.checklist ?? []).filter((i) => i.id !== req.params.itemId);
    }),
    "POST /tasks/:id/focus/:mode": withTask((task, req) => {
      if (req.params.mode === "start") {
        for (const other of store.tasks) other.focusStartedAt = null;
        task.focusStartedAt = nowIso();
      } else if (task.focusStartedAt) {
        task.actualMinutes = (task.actualMinutes ?? 0) + Math.max(1, Math.round((Date.now() - Date.parse(task.focusStartedAt)) / 60_000));
        task.focusStartedAt = null;
      }
    }),
    "PUT /tasks/:id/today-focus": withTask((task, req) => {
      const date = bodyOf(req).date;
      task.todayFocusOn = typeof date === "string" && date ? date : null;
    }),
    "PUT /tasks/:id/schedule-lock": withTask((task, req) => {
      task.scheduleLocked = Boolean(bodyOf(req).locked);
    }),
    "POST /tasks/:id/blocks": withTask((task, req) => {
      const body = bodyOf(req);
      const start = String(body.start ?? nowIso());
      const minutes = typeof body.durationMinutes === "number" ? body.durationMinutes : task.duration || 30;
      const end = typeof body.end === "string" ? body.end : new Date(Date.parse(start) + minutes * 60_000).toISOString();
      const blocks = body.replace ? [] : task.blocks ?? [];
      const block: ScheduledBlock = { id: nextId(store, "blk"), taskId: task.id, start, end, source: "manual", chunkIndex: blocks.length, locked: false };
      task.blocks = [...blocks, block];
    }),
    "DELETE /tasks/:id/blocks": withTask((task) => {
      task.blocks = [];
      task.scheduledOn = null;
    }),
    // Occurrence edits, series splits and anything else under a task answer with the task.
    "POST /tasks/:id/:action": withTask(() => {}),
    "PUT /tasks/:id/:action": withTask(() => {}),
    "PUT /blocks/:id": (req) => {
      const hit = findBlock(req.params.id);
      if (!hit) return undefined;
      const body = bodyOf(req);
      const length = Date.parse(hit.block.end) - Date.parse(hit.block.start);
      if (typeof body.start === "string") hit.block.start = body.start;
      hit.block.end = typeof body.end === "string" ? body.end : new Date(Date.parse(hit.block.start) + length).toISOString();
      hit.block.source = "manual";
      return { message: "block moved", block: hit.block };
    },
    "PUT /blocks/:id/lock": (req) => {
      const hit = findBlock(req.params.id);
      if (!hit) return undefined;
      hit.block.locked = Boolean(bodyOf(req).locked);
      return { block: hit.block };
    },
    "DELETE /blocks/:id": (req) => {
      const hit = findBlock(req.params.id);
      if (!hit) return undefined;
      hit.task.blocks = (hit.task.blocks ?? []).filter((b) => b.id !== req.params.id);
      return { message: "block removed" };
    },

    // ---- Inbox
    "GET /inbox": () => store.tasks.filter(isInbox).map((t) => hydrateTask(store, t)),
    "POST /inbox": (req) => ({ task: hydrateTask(store, createTask(store, { name: bodyOf(req).name }, "inbox")) }),
    "POST /inbox/:id/clarify": (req) => {
      const inbox = findTask(req.params.id);
      if (!inbox || !isInbox(inbox)) return undefined;
      store.tasks = store.tasks.filter((t) => t.id !== inbox.id);
      const body = bodyOf(req);
      return { task: hydrateTask(store, createTask(store, { name: inbox.name, ...body }, body.kind === "reminder" ? "reminder" : "task")) };
    },

    // ---- Projects
    "GET /projects": () => store.projects.map((p) => projectListItem(store, p)),
    "GET /projects/:id": (req) => projectOut(req.params.id),
    "GET /projects/:id/activity": (req) => projectActivity(store, req.params.id),
    "POST /projects": (req) => {
      const body = bodyOf(req);
      const project = {
        id: nextId(store, "prj"),
        title: String(body.title ?? "Untitled project"),
        description: typeof body.description === "string" ? body.description : null,
        workspaceId: String(body.workspaceId ?? store.workspaces[0].id),
        statusId: typeof body.statusId === "string" ? body.statusId : null,
        deadline: typeof body.deadline === "string" ? body.deadline : null,
        startDate: typeof body.startDate === "string" ? body.startDate : null,
        priorityLevel: typeof body.priorityLevel === "string" ? body.priorityLevel : null,
        color: typeof body.color === "string" ? body.color : null,
        doesHaveStages: Boolean(body.doesHaveStages),
        completedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.projects.push(project);
      return { project: projectDetail(store, project) };
    },
    "PUT /projects/:id": (req) => {
      const project = store.projects.find((p) => p.id === req.params.id);
      if (!project) return undefined;
      for (const [key, value] of Object.entries(bodyOf(req))) assign(project, key, value === "" ? null : value);
      project.updatedAt = nowIso();
      return { project: projectDetail(store, project) };
    },
    "DELETE /projects/:id": (req) => {
      store.projects = store.projects.filter((p) => p.id !== req.params.id);
      store.tasks = store.tasks.filter((t) => t.projectId !== req.params.id);
      return { message: "project deleted" };
    },
    "POST /projects/:id/duplicate": (req) => {
      const source = store.projects.find((p) => p.id === req.params.id);
      if (!source) return undefined;
      const copy = { ...structuredClone(source), id: nextId(store, "prj"), title: `${source.title} (copy)`, createdAt: nowIso(), updatedAt: nowIso() };
      store.projects.push(copy);
      return { project: projectDetail(store, copy) };
    },
    "POST /projects/:id/stages": (req) => {
      const body = bodyOf(req);
      const order = store.stages.filter((s) => s.projectId === req.params.id).length;
      const stage: Stage = { id: nextId(store, "stg"), name: String(body.name ?? "New stage"), color: typeof body.color === "string" ? body.color : null, order, projectId: req.params.id, createdAt: nowIso(), updatedAt: nowIso() };
      store.stages.push(stage);
      return stage;
    },
    "PUT /projects/:id/stages/reorder": (req) => {
      const ids = (bodyOf(req).ids as string[] | undefined) ?? [];
      ids.forEach((id, order) => {
        const stage = store.stages.find((s) => s.id === id);
        if (stage) stage.order = order;
      });
      return store.stages.filter((s) => s.projectId === req.params.id).sort((a, b) => a.order - b.order);
    },
    "PUT /projects/:id/stages/:stageId": (req) => {
      const stage = store.stages.find((s) => s.id === req.params.stageId);
      if (!stage) return undefined;
      Object.assign(stage, bodyOf(req), { updatedAt: nowIso() });
      return stage;
    },
    "DELETE /projects/:id/stages/:stageId": (req) => {
      store.stages = store.stages.filter((s) => s.id !== req.params.stageId);
      for (const task of store.tasks) if (task.stageId === req.params.stageId) task.stageId = null;
      return { message: "stage deleted" };
    },

    // ---- Calendar & scheduling
    "GET /calendar": (req) => {
      const from = parseDate(req.query.get("from"), clock.today0);
      const to = parseDate(req.query.get("to"), new Date(from.getTime() + 7 * 86_400_000));
      return { from: from.toISOString(), to: to.toISOString(), items: calendarItems(store, from, to) };
    },
    "GET /today": (req) => today(store, req.query.get("date"), req.query.get("timezone")),
    "GET /events": () => store.events,
    "GET /events/:id": (req) => store.events.find((e) => e.id === req.params.id),
    "POST /events": (req) => {
      const body = bodyOf(req);
      const start = String(body.start ?? nowIso());
      const end = String(body.end ?? new Date(Date.parse(start) + 3_600_000).toISOString());
      const event: CalendarEventEntity = {
        id: nextId(store, "evt"),
        title: String(body.title ?? "New event"),
        description: String(body.description ?? ""),
        start,
        end,
        duration: Math.round((Date.parse(end) - Date.parse(start)) / 60_000),
        allDay: Boolean(body.allDay),
        color: typeof body.color === "string" && body.color ? body.color : null,
        userId: store.user.id,
        workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : null,
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        taskId: typeof body.taskId === "string" ? body.taskId : null,
        recurrence: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (body.recurrence) event.recurrence = recurrenceRule(body.recurrence as RecurrenceInput, "event", event.id);
      store.events.push(event);
      return { event };
    },
    "PUT /events/:id": (req) => {
      const event = store.events.find((e) => e.id === req.params.id);
      if (!event) return undefined;
      for (const [key, value] of Object.entries(bodyOf(req))) {
        if (key === "recurrence") event.recurrence = value ? recurrenceRule(value as RecurrenceInput, "event", event.id) : null;
        else assign(event, key, key === "color" && value === "" ? null : value);
      }
      event.duration = Math.round((Date.parse(event.end) - Date.parse(event.start)) / 60_000);
      event.updatedAt = nowIso();
      return { event };
    },
    "DELETE /events/:id": (req) => {
      store.events = store.events.filter((e) => e.id !== req.params.id);
      return { message: "event deleted" };
    },
    "POST /events/:id/:action": (req) => {
      const event = store.events.find((e) => e.id === req.params.id);
      return event ? { event } : undefined;
    },
    "PUT /events/:id/:action": (req) => {
      const event = store.events.find((e) => e.id === req.params.id);
      return event ? { event } : undefined;
    },
    "GET /schedule/settings": () => store.scheduleSettings,
    "PUT /schedule/settings": (req) => Object.assign(store.scheduleSettings, bodyOf(req)),
    "GET /schedule/working-hours": () => store.config.workingHours,
    "PUT /schedule/working-hours": (req) => {
      const body = bodyOf(req);
      store.config.workingHours = { timezone: String(body.timezone ?? store.config.workingHours?.timezone ?? "UTC"), days: (body.days ?? {}) as NonNullable<Config["workingHours"]>["days"], isDefault: false };
      return store.config.workingHours;
    },
    "GET /schedule/rank": () => ({ items: rank(store) }),
    "GET /schedule/capacity": (req) => {
      const from = parseDate(req.query.get("from"), clock.today0);
      const to = parseDate(req.query.get("to"), new Date(from.getTime() + 7 * 86_400_000));
      return { days: capacity(store, from, to) };
    },

    // ---- Docs
    "GET /docs": () => store.docs.filter((d) => !d.archivedAt),
    "GET /docs/:id": (req) => store.docs.find((d) => d.id === req.params.id),
    "POST /docs": (req) => {
      const body = bodyOf(req);
      const content = (body.content as DocContent | undefined) ?? { type: "doc", content: [{ type: "paragraph" }] };
      const doc: Doc = {
        id: nextId(store, "doc"),
        title: String(body.title ?? ""),
        icon: typeof body.icon === "string" ? body.icon : null,
        content,
        plainText: plainOf(content),
        parentId: typeof body.parentId === "string" ? body.parentId : null,
        workspaceId: String(body.workspaceId ?? store.workspaces[0].id),
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        userId: store.user.id,
        isFavorite: false,
        archivedAt: null,
        order: store.docs.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.docs.push(doc);
      return { document: doc };
    },
    "PUT /docs/:id": (req) => {
      const doc = store.docs.find((d) => d.id === req.params.id);
      if (!doc) return undefined;
      for (const [key, value] of Object.entries(bodyOf(req))) {
        if (key === "archived") doc.archivedAt = value ? nowIso() : null;
        else assign(doc, key, value);
      }
      if (bodyOf(req).content) doc.plainText = plainOf(doc.content);
      doc.updatedAt = nowIso();
      return { document: doc };
    },
    "DELETE /docs/:id": (req) => {
      store.docs = store.docs.filter((d) => d.id !== req.params.id && d.parentId !== req.params.id);
      return { message: "document deleted" };
    },

    // ---- Sheets
    "GET /sheets": () => store.sheets.filter((s) => !s.archivedAt),
    "GET /sheets/:id": (req) => store.sheets.find((s) => s.id === req.params.id),
    "POST /sheets": (req) => {
      const body = bodyOf(req);
      const template = store.templates.find((t) => t.id === body.templateId);
      const sheet: Sheet = {
        id: nextId(store, "sht"),
        title: String(body.title ?? template?.name ?? "Untitled sheet"),
        icon: typeof body.icon === "string" ? body.icon : template?.icon ?? null,
        columns: (body.columns as Sheet["columns"]) ?? structuredClone(template?.columns ?? []),
        rows: (body.rows as Sheet["rows"]) ?? structuredClone(template?.rows ?? []),
        merges: [],
        tabs: (body.tabs as Sheet["tabs"]) ?? [],
        workspaceId: String(body.workspaceId ?? store.workspaces[0].id),
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        userId: store.user.id,
        isFavorite: false,
        archivedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.sheets.push(sheet);
      return { sheet };
    },
    "PUT /sheets/:id": (req) => {
      const sheet = store.sheets.find((s) => s.id === req.params.id);
      if (!sheet) return undefined;
      for (const [key, value] of Object.entries(bodyOf(req))) {
        if (key === "archived") sheet.archivedAt = value ? nowIso() : null;
        else assign(sheet, key, value);
      }
      sheet.updatedAt = nowIso();
      return { sheet };
    },
    "DELETE /sheets/:id": (req) => {
      store.sheets = store.sheets.filter((s) => s.id !== req.params.id);
      return { message: "sheet deleted" };
    },
    "POST /sheets/:id/duplicate": (req) => {
      const source = store.sheets.find((s) => s.id === req.params.id);
      if (!source) return undefined;
      const copy = { ...structuredClone(source), id: nextId(store, "sht"), title: `${source.title} (copy)`, isFavorite: false, createdAt: nowIso(), updatedAt: nowIso() };
      store.sheets.push(copy);
      return { sheet: copy };
    },
    "GET /sheet-templates": () => store.templates,
    "GET /sheet-templates/:id": (req) => store.templates.find((t) => t.id === req.params.id),
    "POST /sheet-templates/:id/tab": (req) => {
      const template = store.templates.find((t) => t.id === req.params.id);
      if (!template) return undefined;
      return { tab: { id: nextId(store, "tab"), name: template.name, columns: structuredClone(template.columns), rows: structuredClone(template.rows), merges: [] } };
    },

    // ---- Chat & agent
    "GET /chats": () => [...store.chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary),
    "GET /chats/images/:id": () => sampleImageBlob(),
    "GET /chats/:id": (req) => store.chats.find((c) => c.id === req.params.id),
    "POST /chats": (req) => {
      const body = bodyOf(req);
      const at = nowIso();
      const content = String(body.content ?? "");
      const chat: Chat = {
        id: nextId(store, "chat"),
        title: content.slice(0, 60) || "New chat",
        status: "idle",
        phase: "",
        webSearch: Boolean(body.webSearch),
        provider: "claude",
        model: "sonnet",
        context: Array.isArray(body.context) ? (body.context as Chat["context"]) : [],
        messages: [{ id: nextId(store, "msg"), role: "user", kind: "", content, createdAt: at }],
        plan: [],
        revision: 1,
        unread: false,
        error: "",
        createdAt: at,
        updatedAt: at,
      };
      store.chats.unshift(chat);
      return chat;
    },
    "PATCH /chats/:id": (req) => {
      const chat = store.chats.find((c) => c.id === req.params.id);
      if (!chat) return undefined;
      const body = bodyOf(req);
      if (typeof body.title === "string") chat.title = body.title;
      if (typeof body.webSearch === "boolean") chat.webSearch = body.webSearch;
      return chat;
    },
    "DELETE /chats/:id": (req) => {
      store.chats = store.chats.filter((c) => c.id !== req.params.id);
      return { message: "deleted" };
    },
    "POST /chats/:id/:action": (req) => {
      const chat = store.chats.find((c) => c.id === req.params.id);
      if (!chat) return undefined;
      const at = nowIso();
      const notice = (content: string) => chat.messages.push({ id: nextId(store, "msg"), role: "assistant", kind: "notice", content, createdAt: at });
      switch (req.params.action) {
        case "read":
          chat.unread = false;
          break;
        case "messages":
          chat.messages.push({ id: nextId(store, "msg"), role: "user", kind: "", content: String(bodyOf(req).content ?? ""), createdAt: at });
          break;
        case "approve":
          chat.messages.push({ id: nextId(store, "msg"), role: "assistant", kind: "", content: "Applied the approved changes.", createdAt: at, steps: chat.plan.map((s) => ({ ...s, status: "done" })) });
          notice(`Done: ${chat.plan.length} ${chat.plan.length === 1 ? "change" : "changes"} applied`);
          chat.plan = [];
          chat.status = "idle";
          break;
        case "reject":
          chat.messages.push({ id: nextId(store, "msg"), role: "assistant", kind: "archive", content: "Discarded proposal", createdAt: at, steps: chat.plan.map((s) => ({ ...s, status: "discarded" })) });
          chat.plan = [];
          chat.status = "idle";
          break;
        case "stop":
          chat.status = "stopped";
          notice("Stopped");
          break;
      }
      chat.revision += 1;
      chat.updatedAt = at;
      return chat;
    },
    "GET /agent/providers": () => store.providers,
    "GET /agent/providers/:id/models": (req) => providerModels(req.params.id as ProviderId, req.query.get("kind")),
    "PATCH /agent/providers": (req) => {
      const body = bodyOf(req);
      const p = store.providers;
      if (body.defaultProvider) p.defaultProvider = body.defaultProvider as ProviderId;
      if (typeof body.claudeModel === "string") p.claude.model = body.claudeModel;
      if (typeof body.codexModel === "string") p.codex.model = body.codexModel;
      if (typeof body.openrouterChatModel === "string") p.openrouter.chatModel = body.openrouterChatModel;
      if (typeof body.openrouterEmbedModel === "string") p.openrouter.embedModel = body.openrouterEmbedModel;
      return p;
    },
    "/agent/providers/:id/:action": () => store.providers,

    // ---- Notifications & jobs
    "GET /notifications": (req) => {
      const unread = req.query.get("unread") === "true";
      const items = visibleNotifications()
        .filter((n) => !unread || !n.readAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { items };
    },
    "GET /notifications/unread-count": () => ({ count: visibleNotifications().filter((n) => !n.readAt).length }),
    "GET /notifications/settings": () => store.notificationSettings,
    "PUT /notifications/settings": (req) => Object.assign(store.notificationSettings, bodyOf(req)),
    "POST /notifications/read-all": () => {
      for (const n of store.notifications) n.readAt ??= nowIso();
      return { ok: true };
    },
    "POST /notifications/clear": () => {
      store.notifications = [];
      return { ok: true };
    },
    "POST /notifications/:id/read": (req) => {
      const n = store.notifications.find((x) => x.id === req.params.id);
      if (!n) return undefined;
      n.readAt ??= nowIso();
      return n;
    },
    "POST /notifications/:id/snooze": (req) => {
      const n = store.notifications.find((x) => x.id === req.params.id);
      if (!n) return undefined;
      const body = bodyOf(req);
      const minutes = typeof body.minutes === "number" ? body.minutes : 15;
      n.snoozedUntil = typeof body.until === "string" ? body.until : new Date(Date.now() + minutes * 60_000).toISOString();
      return n;
    },
    "GET /jobs": (req) => {
      const status = req.query.get("status");
      return { items: store.jobs.filter((j) => !status || j.status === status) };
    },
    "GET /jobs/health": () => buildJobHealth(store.jobs),
    "POST /jobs/:id/retry": (req) => {
      const job = store.jobs.find((j) => j.id === req.params.id);
      if (!job) return undefined;
      Object.assign(job, { status: "pending", attempts: 0, lastError: null, runAt: nowIso(), updatedAt: nowIso() });
      return job;
    },

    // ---- Search
    "GET /search": (req) => search(store, req.query.get("q") ?? ""),
  };
  return routes;
}
