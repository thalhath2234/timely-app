"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  Check,
  FileText,
  Flag,
  ListTodo,
  Sheet as SheetIcon,
  type LucideIcon,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import DateTimeField from "./DateTimeField";
import { createTask } from "@/app/utils/api/tasks";
import { tasksKey } from "@/app/utils/hooks/tasks";
import { useCreateEvent } from "@/app/utils/hooks/calendar";
import { useCreateDoc } from "@/app/utils/hooks/docs";
import { useCreateSheet } from "@/app/utils/hooks/sheets";
import { useMobileWorkspaces } from "@/app/_lib/mobile/useMobileData";
import { useDemoStore } from "@/app/_lib/mobile/demoStore";
import { addDays, startOfDay } from "@/app/_lib/mobile/format";
import type { Task } from "@/app/_types/types";

type Kind = "task" | "event" | "doc" | "sheet";

const KINDS: { value: Kind; label: string; icon: LucideIcon; hint: string }[] = [
  { value: "task", label: "Task", icon: ListTodo, hint: "Something to do" },
  { value: "event", label: "Event", icon: CalendarClock, hint: "Time on the calendar" },
  { value: "doc", label: "Doc", icon: FileText, hint: "Notes and writing" },
  { value: "sheet", label: "Sheet", icon: SheetIcon, hint: "Rows and columns" },
];

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/** Next quarter-hour from now, the natural default for a new event. */
function nextSlot() {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

export default function QuickAddSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: workspaces, isDemo } = useMobileWorkspaces();
  const addDemoTask = useDemoStore((s) => s.addTask);

  const [kind, setKind] = useState<Kind>("task");
  const [title, setTitle] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number] | null>(null);
  const [eventStart, setEventStart] = useState<Date>(() => nextSlot());
  const [eventEnd, setEventEnd] = useState<Date>(() => new Date(nextSlot().getTime() + 3_600_000));
  const [allDay, setAllDay] = useState(false);

  const activeWorkspaceId = workspaceId || workspaces[0]?.id || "";

  const createTaskMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tasksKey }),
  });
  const createEvent = useCreateEvent();
  const createDoc = useCreateDoc();
  const createSheet = useCreateSheet();

  const pending =
    createTaskMutation.isPending ||
    createEvent.isPending ||
    createDoc.isPending ||
    createSheet.isPending;

  function reset() {
    setTitle("");
    setDeadline(null);
    setPriority(null);
    setKind("task");
    const start = nextSlot();
    setEventStart(start);
    setEventEnd(new Date(start.getTime() + 3_600_000));
    setAllDay(false);
  }

  function dueDate(): string | undefined {
    return deadline ? deadline.toISOString() : undefined;
  }

  /** Keep the end after the start when the start moves. */
  function changeStart(next: Date | null) {
    if (!next) return;
    const duration = Math.max(eventEnd.getTime() - eventStart.getTime(), 15 * 60_000);
    setEventStart(next);
    setEventEnd(new Date(next.getTime() + duration));
  }

  function eventRange() {
    if (!allDay) return { start: eventStart, end: eventEnd };
    const start = startOfDay(eventStart);
    return { start, end: addDays(start, 1) };
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const name = title.trim();
    if (!name || pending) return;

    if (kind === "task") {
      if (isDemo) {
        const ws = workspaces.find((w) => w.id === activeWorkspaceId);
        const status = ws?.status.find((s) => s.isDefault) ?? ws?.status[0] ?? null;
        const now = new Date().toISOString();
        const demoTask: Task = {
          id: `t_new_${Date.now()}`,
          name,
          description: "",
          timeChunks: 1,
          duration: 60,
          deadline: dueDate() ?? null,
          startDate: null,
          scheduledOn: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          userId: "u_1",
          projectId: null,
          statusId: status?.id ?? null,
          priorityLevel: priority,
          workspaceId: activeWorkspaceId,
          scheduleId: null,
          stageId: null,
          blockedById: null,
          project: null,
          workspace: ws ?? null,
          status,
          labels: [],
          labelIds: [],
          blocks: [],
        };
        addDemoTask(demoTask);
        finish("/m/tasks");
        return;
      }
      await createTaskMutation.mutateAsync({
        name,
        workspaceId: activeWorkspaceId,
        deadline: dueDate(),
        priorityLevel: priority ?? undefined,
      });
      finish("/m/tasks");
      return;
    }

    if (kind === "event") {
      if (!isDemo) {
        const { start, end } = eventRange();
        await createEvent.mutateAsync({
          title: name,
          start: start.toISOString(),
          end: end.toISOString(),
          allDay,
          workspaceId: activeWorkspaceId,
        });
      }
      finish("/m/calendar");
      return;
    }

    if (kind === "doc") {
      if (!isDemo) {
        const doc = await createDoc.mutateAsync({ title: name, workspaceId: activeWorkspaceId });
        finish(`/m/docs/${doc.id}`);
        return;
      }
      finish("/m/docs");
      return;
    }

    if (!isDemo) {
      const sheet = await createSheet.mutateAsync({ title: name, workspaceId: activeWorkspaceId });
      finish(`/m/sheets/${sheet.id}`);
      return;
    }
    finish("/m/sheets");
  }

  function finish(href: string) {
    reset();
    onClose();
    router.push(href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="New">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Type" className="grid grid-cols-4 gap-2">
          {KINDS.map((k) => {
            const active = k.value === kind;
            const Icon = k.icon;
            return (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKind(k.value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border bg-card text-muted-foreground active:bg-muted"
                }`}
              >
                <Icon size={20} />
                {k.label}
              </button>
            );
          })}
        </div>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            kind === "task"
              ? "What needs doing?"
              : kind === "event"
                ? "Event title"
                : kind === "doc"
                  ? "Untitled doc"
                  : "Untitled sheet"
          }
          aria-label="Title"
          className="h-12 w-full rounded-xl border border-input bg-card px-4 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
        />

        {workspaces.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <span className="px-1 text-xs font-medium text-muted-foreground">Workspace</span>
            <div className="flex gap-2 overflow-x-auto scrollbar-none">
              {workspaces.map((w) => {
                const active = w.id === activeWorkspaceId;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setWorkspaceId(w.id)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                      active
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {w.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {kind === "event" ? (
          <div className="flex flex-col gap-2">
            <DateTimeField
              label="Starts"
              value={eventStart}
              onChange={changeStart}
              mode={allDay ? "date" : "datetime"}
              clearable={false}
            />
            <DateTimeField
              label="Ends"
              value={eventEnd}
              onChange={(next) => next && setEventEnd(next)}
              mode={allDay ? "date" : "datetime"}
              clearable={false}
              min={eventStart}
            />
            <label className="flex h-12 items-center justify-between rounded-xl border border-input bg-card px-4">
              <span className="flex items-center gap-3 text-[13px] font-medium text-muted-foreground">
                <CalendarDays size={18} /> All day
              </span>
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="h-5 w-5 accent-primary"
              />
            </label>
          </div>
        ) : null}

        {kind === "task" ? (
          <>
            <DateTimeField
              label="Due"
              value={deadline}
              onChange={setDeadline}
              mode="datetime"
              placeholder="No date"
            />
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                <Flag size={13} /> Priority
              </span>
              <div className="flex gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(priority === p ? null : p)}
                    className={`flex-1 rounded-lg border py-2 text-[13px] font-medium capitalize ${
                      priority === p
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <button
          type="submit"
          disabled={!title.trim() || pending}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <Check size={18} />
          {pending ? "Saving…" : `Add ${kind}`}
        </button>
        {isDemo && kind !== "task" ? (
          <p className="text-center text-xs text-muted-foreground">
            Sample mode: {kind}s are not persisted without the API.
          </p>
        ) : null}
      </form>
    </BottomSheet>
  );
}
