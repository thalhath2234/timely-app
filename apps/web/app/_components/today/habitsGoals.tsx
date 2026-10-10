"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Flame, GripVertical, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { MAX_FOCUS_NAME, MAX_GOALS, MAX_HABITS, type Goal, type Habit } from "@/app/utils/api/focus";
import {
  useAddGoal,
  useAddHabit,
  useCheckHabit,
  useDeleteGoal,
  useDeleteHabit,
  useGoalProgress,
  useGoals,
  useHabits,
  useRenameGoal,
  useRenameHabit,
  useReorderGoals,
  useReorderHabits,
} from "@/app/utils/hooks/focus";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";

const failed = (fallback: string) => (error: unknown) => {
  useToastStore.getState().show(error instanceof Error ? error.message : fallback);
};

/** The dragged id takes the place of the one it is dropped on. */
function moveId(ids: string[], from: string, to: string) {
  const next = ids.filter((id) => id !== from);
  next.splice(ids.indexOf(to), 0, from);
  return next;
}

function shortDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const heading = "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground";
const label = "text-xs font-medium text-muted-foreground";
const linkButton = "font-medium text-primary hover:underline disabled:opacity-50";
const input =
  "min-w-0 flex-1 rounded-md border border-border bg-input/30 px-2 py-1 text-sm outline-none focus:border-primary/60";
const iconButton =
  "shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/** Habits and goals at the top of Today: tick a habit for today and see its
 * streak, and see each goal with the open Work that moves it forward (only
 * with smart suggestions on). Edit mode adds, renames, reorders and deletes. */
export default function HabitsGoals({ today, version }: { today: string; version: string }) {
  const habits = useHabits(today);
  const goals = useGoals();
  const [editing, setEditing] = useState(false);
  const [focusAdd, setFocusAdd] = useState<"habit" | "goal" | null>(null);

  if (!habits.data || !goals.data) return null;
  const habitList = habits.data.habits;
  const goalList = goals.data;

  const startEditing = (target: "habit" | "goal" | null) => {
    setFocusAdd(target);
    setEditing(true);
  };

  if (!editing && habitList.length === 0 && goalList.length === 0) {
    return (
      <section
        aria-label="Habits and goals"
        data-testid="today-habits-goals"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        <Flame className="size-3.5 text-warning" />
        <span>Track a daily habit or name what you are working toward.</span>
        <button type="button" onClick={() => startEditing("habit")} className={linkButton}>
          Add a habit
        </button>
        <button type="button" onClick={() => startEditing("goal")} className={linkButton}>
          Add a goal
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="today-habits-goals" aria-label="Habits and goals">
      <div className="flex items-center justify-between gap-3">
        <h2 className={heading}>
          <Flame className="size-3.5 text-warning" />
          Habits and goals
        </h2>
        <button
          type="button"
          onClick={() => (editing ? setEditing(false) : startEditing(null))}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {editing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4 text-sm">
        {editing ? (
          <>
            <HabitEditor today={today} habits={habitList} autoFocus={focusAdd === "habit"} />
            <GoalEditor goals={goalList} autoFocus={focusAdd === "goal"} />
          </>
        ) : (
          <>
            <HabitChips today={today} habits={habitList} onAdd={() => startEditing("habit")} />
            <GoalRows goals={goalList} version={version} onAdd={() => startEditing("goal")} />
          </>
        )}
      </div>
    </section>
  );
}

function HabitChips({ today, habits, onAdd }: { today: string; habits: Habit[]; onAdd: () => void }) {
  const check = useCheckHabit(today);
  if (habits.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No habits yet.{" "}
        <button type="button" onClick={onAdd} className={linkButton}>
          Add a habit
        </button>
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Habits">
      {habits.map((habit) => {
        const days = habit.last7.filter(Boolean).length;
        return (
          <li key={habit.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={habit.doneToday}
              title={`${habit.streak} day streak · done ${days} of the last 7 days`}
              onClick={() =>
                check.mutate(
                  { id: habit.id, done: !habit.doneToday },
                  { onError: failed("Could not update the habit") },
                )
              }
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                habit.doneToday
                  ? "border-success/30 bg-success/10 text-foreground"
                  : "border-border bg-card text-foreground hover:bg-accent/40",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border",
                  habit.doneToday ? "border-success bg-success/20 text-success" : "border-muted-foreground/50",
                )}
              >
                {habit.doneToday ? <Check className="size-3 stroke-[3]" /> : null}
              </span>
              <span className="max-w-[14rem] truncate">{habit.name}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 tabular-nums",
                  habit.streak > 0 ? "text-warning" : "text-muted-foreground/70",
                )}
              >
                <Flame className="size-3" />
                {habit.streak}
              </span>
            </button>
          </li>
        );
      })}
      {habits.length < MAX_HABITS ? (
        <li>
          <button
            type="button"
            aria-label="Add a habit"
            title="Add a habit"
            onClick={onAdd}
            className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-1 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Plus className="size-3.5" />
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function GoalRows({ goals, version, onAdd }: { goals: Goal[]; version: string; onAdd: () => void }) {
  const progress = useGoalProgress(`${version}|${goals.map((goal) => `${goal.id}:${goal.title}`).join(",")}`, goals.length > 0);
  const openTask = useEntityDetailStore((state) => state.openTask);
  const [open, setOpen] = useState<string | null>(null);
  if (goals.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No goals yet.{" "}
        <button type="button" onClick={onAdd} className={linkButton}>
          Add a goal
        </button>
      </p>
    );
  }
  const items = new Map((progress.data?.goals ?? []).map((goal) => [goal.goalId, goal.items]));
  return (
    <div className="space-y-1">
      <ul className="space-y-0.5" aria-label="Goals">
        {goals.map((goal) => {
          const work = progress.data?.available ? items.get(goal.id) : undefined;
          const expanded = open === goal.id && Boolean(work?.length);
          return (
            <li key={goal.id}>
              <div className="flex items-center gap-2 rounded-lg px-1 py-1">
                <Target className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-foreground">{goal.title}</span>
                {work ? (
                  work.length ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : goal.id)}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {work.length} item{work.length === 1 ? "" : "s"}
                      <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground/70">0 items</span>
                  )
                ) : null}
              </div>
              {expanded && work ? (
                <ul className="mb-1 ml-6 space-y-0.5 border-l border-border pl-3">
                  {work.map((item) => (
                    <li key={item.taskId}>
                      <button
                        type="button"
                        onClick={() => openTask(item.taskId)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-xs hover:bg-accent/40"
                      >
                        <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
                        {item.deadline ? (
                          <span className="shrink-0 text-muted-foreground">Due {shortDate(item.deadline)}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {progress.data?.error ? <p className="px-1 text-[11px] text-muted-foreground">{progress.data.error}</p> : null}
    </div>
  );
}

/** One row of an edit list: drag handle, an inline name field and delete. */
function EditRow({
  name,
  dragging,
  onDragStart,
  onDrop,
  onRename,
  onDelete,
  what,
  children,
}: {
  name: string;
  dragging: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  what: string;
  children?: ReactNode;
}) {
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5",
        dragging && "opacity-50",
      )}
    >
      <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
      {children}
      <input
        key={name}
        defaultValue={name}
        maxLength={MAX_FOCUS_NAME}
        aria-label={`Rename ${what} ${name}`}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (!next) event.currentTarget.value = name;
          else if (next !== name) onRename(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = name;
            event.currentTarget.blur();
          }
        }}
        className={input}
      />
      <button type="button" aria-label={`Delete ${what} ${name}`} title="Delete" onClick={onDelete} className={iconButton}>
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}

function AddField({
  placeholder,
  disabled,
  full,
  autoFocus,
  onAdd,
}: {
  placeholder: string;
  disabled: boolean;
  full: string | null;
  autoFocus: boolean;
  onAdd: (name: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  if (full) return <p className="text-xs text-muted-foreground">{full}</p>;
  const submit = () => {
    const name = draft.trim();
    if (!name) return;
    void onAdd(name).then(() => setDraft(""), failed("Could not add it"));
  };
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus={autoFocus}
        value={draft}
        maxLength={MAX_FOCUS_NAME}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
        className={input}
      />
      <button
        type="button"
        disabled={disabled || !draft.trim()}
        onClick={submit}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        <Plus className="size-3" /> Add
      </button>
    </div>
  );
}

function HabitEditor({ today, habits, autoFocus }: { today: string; habits: Habit[]; autoFocus: boolean }) {
  const add = useAddHabit();
  const rename = useRenameHabit();
  const remove = useDeleteHabit();
  const reorder = useReorderHabits(today);
  const [dragging, setDragging] = useState<string | null>(null);
  const ids = habits.map((habit) => habit.id);
  return (
    <div className="space-y-1.5">
      <p className={label}>Habits</p>
      {habits.length ? (
        <ul className="space-y-1">
          {habits.map((habit) => (
            <EditRow
              key={habit.id}
              what="habit"
              name={habit.name}
              dragging={dragging === habit.id}
              onDragStart={() => setDragging(habit.id)}
              onDrop={() => {
                if (dragging && dragging !== habit.id)
                  reorder.mutate(moveId(ids, dragging, habit.id), { onError: failed("Could not reorder habits") });
                setDragging(null);
              }}
              onRename={(name) => rename.mutate({ id: habit.id, name }, { onError: failed("Could not rename the habit") })}
              onDelete={() =>
                requestConfirm({
                  title: `Delete “${habit.name}”?`,
                  description: "Its streak and check-ins are deleted too.",
                  confirmLabel: "Delete",
                  pendingLabel: "Deleting…",
                  onConfirm: () => remove.mutateAsync(habit.id).then(() => undefined, failed("Could not delete the habit")),
                })
              }
            />
          ))}
        </ul>
      ) : null}
      <AddField
        placeholder="Add a habit, like “Walk 20 minutes”"
        disabled={add.isPending}
        full={habits.length >= MAX_HABITS ? `You have ${MAX_HABITS} habits, the most you can keep.` : null}
        autoFocus={autoFocus}
        onAdd={(name) => add.mutateAsync(name)}
      />
    </div>
  );
}

function GoalEditor({ goals, autoFocus }: { goals: Goal[]; autoFocus: boolean }) {
  const add = useAddGoal();
  const rename = useRenameGoal();
  const remove = useDeleteGoal();
  const reorder = useReorderGoals();
  const [dragging, setDragging] = useState<string | null>(null);
  const ids = goals.map((goal) => goal.id);
  return (
    <div className="space-y-1.5">
      <p className={label}>Goals (up to {MAX_GOALS})</p>
      {goals.length ? (
        <ul className="space-y-1">
          {goals.map((goal) => (
            <EditRow
              key={goal.id}
              what="goal"
              name={goal.title}
              dragging={dragging === goal.id}
              onDragStart={() => setDragging(goal.id)}
              onDrop={() => {
                if (dragging && dragging !== goal.id)
                  reorder.mutate(moveId(ids, dragging, goal.id), { onError: failed("Could not reorder goals") });
                setDragging(null);
              }}
              onRename={(title) => rename.mutate({ id: goal.id, title }, { onError: failed("Could not rename the goal") })}
              onDelete={() =>
                requestConfirm({
                  title: `Remove the goal “${goal.title}”?`,
                  confirmLabel: "Remove",
                  pendingLabel: "Removing…",
                  onConfirm: () => remove.mutateAsync(goal.id).then(() => undefined, failed("Could not remove the goal")),
                })
              }
            >
              <Target className="size-3.5 shrink-0 text-primary" aria-hidden />
            </EditRow>
          ))}
        </ul>
      ) : null}
      <AddField
        placeholder="Add a goal, like “Run a 10k in spring”"
        disabled={add.isPending}
        full={goals.length >= MAX_GOALS ? `You have ${MAX_GOALS} goals, the most you can keep.` : null}
        autoFocus={autoFocus}
        onAdd={(title) => add.mutateAsync(title)}
      />
    </div>
  );
}
