"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ABOUT_YOU,
  NEXT_CHAT_NOTE,
  NOTES,
  budgetMeter,
  type MemoryEdit,
  type MemoryStore,
} from "@timely/contract/agentLearning";
import Button from "@/app/_components/_ui/button";
import { Fill } from "@/app/_components/_ui/dataMotion";
import { Textarea } from "@/app/_components/_ui/field";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { SkeletonRows } from "@/app/_components/_ui/skeleton";
import { requestConfirm } from "@/app/_store/confirmStore";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { cn } from "@/app/utils/cn";
import { useEditMemory, useLearningSettings, useMemory } from "@/app/utils/hooks/learning";
import { EmptyRow, ErrorRow, errorText } from "./learnedShared";

type Target = "user" | "memory";

const COPY: Record<Target, { title: string; add: string; empty: string; id: string }> = {
  user: {
    title: ABOUT_YOU,
    add: "Add to About you",
    empty: "Nothing yet. Timely adds what it learns about you, such as how you like replies.",
    id: "learned-about",
  },
  memory: {
    title: NOTES,
    add: "Add a note",
    empty: "No notes yet. Timely keeps facts here that help in later chats.",
    id: "learned-notes",
  },
};

/** The edit that takes a change back (the toast's Undo). */
function inverse(edit: MemoryEdit): MemoryEdit | null {
  if (edit.action === "add" && edit.content)
    return { target: edit.target, action: "remove", old: edit.content };
  if (edit.action === "remove" && edit.old) return { target: edit.target, action: "add", content: edit.old };
  if (edit.action === "replace" && edit.old && edit.content)
    return { target: edit.target, action: "replace", content: edit.old, old: edit.content };
  return null;
}

/**
 * About you (USER.md) and Notes (MEMORY.md): what Timely knows, each with
 * its budget (1,375 and 2,200 characters), add, edit and delete, and Undo on
 * every change. A chat reads them when it starts, so a change applies from
 * the next chat.
 */
export default function LearnedMemory({ part }: { part: string | null }) {
  const memory = useMemory();
  const settings = useLearningSettings();
  const focus: Target | null = part === "about" ? "user" : part === "notes" ? "memory" : null;
  return (
    <div className="flex flex-col gap-5">
      {(["user", "memory"] as const).map((target) => (
        <MemoryGroup
          key={target}
          target={target}
          store={memory.data?.[target]}
          loading={memory.isPending}
          error={memory.error}
          onRetry={() => void memory.refetch()}
          retrying={memory.isFetching}
          focused={focus === target}
          hint={
            target === "user" && settings.data?.useCaseCopied
              ? "It started with what you use Timely for. Change it here; it is not copied again. Changes apply from your next chat."
              : `Changes ${NEXT_CHAT_NOTE}.`
          }
        />
      ))}
    </div>
  );
}

function MemoryGroup({
  target,
  store,
  loading,
  error,
  onRetry,
  retrying,
  focused,
  hint,
}: {
  target: Target;
  store: MemoryStore | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  focused: boolean;
  hint: string;
}) {
  const copy = COPY[target];
  const edit = useEditMemory();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState("");
  const [formError, setFormError] = useState("");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "start" });
  }, [focused]);
  const meter = store ? budgetMeter(store.used, store.limit) : null;

  async function apply(change: MemoryEdit, done: string) {
    setFormError("");
    try {
      await edit.mutateAsync(change);
      setEditing(null);
      setDraft("");
      const back = inverse(change);
      showUndoToast(
        done,
        back
          ? () =>
              edit.mutate(back, {
                onError: (err) => useToastStore.getState().show(errorText(err, "Couldn't undo that.")),
              })
          : undefined,
      );
    } catch (err) {
      setFormError(errorText(err, "Couldn't save that."));
    }
  }
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !store) return;
    if (editing === "new") void apply({ target, action: "add", content }, `Added to ${copy.title}`);
    else if (typeof editing === "number") {
      const old = store.entries[editing];
      if (old === content) {
        setEditing(null);
        return;
      }
      void apply({ target, action: "replace", content, old }, `${copy.title} updated`);
    }
  }
  function remove(entry: string) {
    requestConfirm({
      title: `Delete this from ${copy.title}?`,
      description: entry.length > 160 ? `${entry.slice(0, 160)}…` : entry,
      confirmLabel: "Delete",
      onConfirm: () => apply({ target, action: "remove", old: entry }, `Deleted from ${copy.title}`),
    });
  }
  function open(index: number | "new") {
    setFormError("");
    setEditing(index);
    setDraft(index === "new" ? "" : (store?.entries[index] ?? ""));
  }

  const form = (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 px-3.5 py-2.5">
      <Textarea
        autoFocus
        aria-label={editing === "new" ? copy.add : `Edit ${copy.title}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="min-h-16 text-[13px]"
        maxLength={2200}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={edit.isPending} disabled={!draft.trim()}>
          Save
        </Button>
        <Button variant="ghost" size="sm" disabled={edit.isPending} onClick={() => setEditing(null)}>
          Cancel
        </Button>
        {formError && (
          <span role="alert" className="text-xs text-destructive">
            {formError}
          </span>
        )}
      </div>
    </form>
  );

  return (
    <section ref={ref} aria-label={copy.title} id={copy.id} data-testid={copy.id} className="scroll-mt-4">
      <GroupLabel aside={meter ? <span className="tabular-nums">{meter.text}</span> : undefined}>{copy.title}</GroupLabel>
      {meter && (
        <Fill
          value={meter.ratio}
          height={4}
          trackClassName="mb-2"
          className={cn(meter.tone === "full" ? "bg-destructive" : meter.tone === "near" ? "bg-warning" : "bg-primary")}
        />
      )}
      <ListGroup className={cn(focused && "ring-2 ring-primary/30")}>
        {loading ? (
          <div className="px-3.5 py-2.5">
            <SkeletonRows rows={2} />
          </div>
        ) : error ? (
          <ErrorRow error={error} what={copy.title} onRetry={onRetry} retrying={retrying} />
        ) : (
          [
            ...(store?.entries.length ? [] : [<EmptyRow key="empty">{copy.empty}</EmptyRow>]),
            ...(store?.entries ?? []).map((entry, index) =>
              editing === index ? (
                <div key={`e${index}`}>{form}</div>
              ) : (
                <div key={`e${index}`} className="flex items-start gap-2 px-3.5 py-2">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words py-1 text-[13px] leading-[18px]">{entry}</p>
                  <Button variant="ghost" size="sm" disabled={edit.isPending} onClick={() => open(index)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" disabled={edit.isPending} onClick={() => remove(entry)}>
                    Delete
                  </Button>
                </div>
              ),
            ),
            editing === "new" ? (
              <div key="new">{form}</div>
            ) : (
              <ListRow key="add" tone="add" label={copy.add} onClick={() => open("new")} />
            ),
          ]
        )}
      </ListGroup>
      <GroupHint>{meter?.tone === "full" ? `${copy.title} is full. Delete or shorten something to make room.` : hint}</GroupHint>
    </section>
  );
}
