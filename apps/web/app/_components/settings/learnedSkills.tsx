"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  NEVER_ARCHIVES,
  RESTORED_REVIEW,
  UPDATED_UPSTREAM,
  type LearnedSkill,
  type LearningEvent,
  type SkillState,
} from "@timely/contract/agentLearning";
import Button from "@/app/_components/_ui/button";
import { Textarea } from "@/app/_components/_ui/field";
import { GroupHint, GroupLabel, ListGroup, ListRow, ListSwitch } from "@/app/_components/_ui/groupedList";
import { SkeletonLines, SkeletonRows } from "@/app/_components/_ui/skeleton";
import DiffView from "@/app/_components/chat/diffView";
import { skillOrigin } from "@/app/_components/chat/learningView";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import type { SkillHistoryEntry } from "@/app/utils/api/learning";
import { cn } from "@/app/utils/cn";
import {
  useChooseUpstream,
  useEditSkill,
  useLearnedSkill,
  useLearnedSkills,
  useRecentLearning,
  useSkillState,
  useUndoLearning,
  useUpstream,
  useUpstreamCompare,
} from "@/app/utils/hooks/learning";
import { EmptyRow, ErrorRow, Tag, errorText, when } from "./learnedShared";

/** Skills the agent wrote or the person's own copies of built-in ones. */
const OWN = new Set(["learned", "edited"]);

/**
 * Skills (plan 9b.4): what the agent learned and the built-in skills the
 * person changed, each with where it came from, its history and diffs,
 * Undo, Edit, Lock, Archive / Restore, Delete and an on/off switch. A
 * restored skill stays off, marked "Restored, review", until turned on
 * (Q-3.4). Built-in skills fold away under one row, and "Updated upstream"
 * lists edited ones whose shipped copy changed (Q-3.7).
 */
export default function LearnedSkills({ focus }: { focus: string | null }) {
  const skills = useLearnedSkills();
  const recent = useRecentLearning();
  const all = skills.data ?? [];
  const own = all.filter((s) => OWN.has(s.source) || s.restored);
  const builtIn = all.filter((s) => !OWN.has(s.source) && !s.restored);
  const focusIsBuiltIn = !!focus && builtIn.some((s) => s.name === focus);
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const [open, setOpen] = useState<string | null>(focus);
  const events = recent.data ?? [];
  const builtInShown = showBuiltIn || focusIsBuiltIn;

  return (
    <section aria-label="Skills" id="learned-skills" data-testid="learned-skills" className="flex flex-col gap-5">
      <div>
        <GroupLabel aside={skills.data ? `${own.length}` : undefined}>Skills</GroupLabel>
        <ListGroup>
          {skills.isPending ? (
            <div className="px-3.5 py-2.5">
              <SkeletonRows rows={3} />
            </div>
          ) : skills.error ? (
            <ErrorRow
              error={skills.error}
              what="skills"
              onRetry={() => void skills.refetch()}
              retrying={skills.isFetching}
            />
          ) : own.length === 0 ? (
            <EmptyRow>
              Nothing learned yet. When a chat on the New engine works out how you like something done, the skill shows
              here.
            </EmptyRow>
          ) : (
            own.map((skill) => (
              <SkillRow
                key={skill.name}
                skill={skill}
                events={events}
                open={open === skill.name}
                focused={focus === skill.name}
                onToggle={() => setOpen(open === skill.name ? null : skill.name)}
              />
            ))
          )}
          {skills.data && builtIn.length > 0 && (
            <ListRow
              label={builtInShown ? "Hide built-in skills" : "Built-in skills"}
              meta={builtInShown ? undefined : "Skills that come with Timely. Turn off any you don't want."}
              onClick={() => setShowBuiltIn(!builtInShown)}
            >
              <span className="text-[13px] font-medium tabular-nums text-muted-foreground">{builtIn.length}</span>
              <ChevronRight
                aria-hidden
                className={cn("size-3.5 text-muted-foreground transition-transform", builtInShown && "rotate-90")}
              />
            </ListRow>
          )}
          {builtInShown &&
            builtIn.map((skill) => (
              <SkillRow
                key={skill.name}
                skill={skill}
                events={events}
                open={open === skill.name}
                focused={focus === skill.name}
                onToggle={() => setOpen(open === skill.name ? null : skill.name)}
              />
            ))}
        </ListGroup>
        <GroupHint>{NEVER_ARCHIVES}</GroupHint>
      </div>
      <UpstreamGroup />
    </section>
  );
}

function sourceWord(skill: LearnedSkill) {
  switch (skill.source) {
    case "learned":
      return "Learned";
    case "edited":
      return "Your copy of a built-in skill";
    case "timely":
      return "Timely's own, read only";
    case "optional":
      return "Optional";
    default:
      return "Built in";
  }
}

function SkillRow({
  skill,
  events,
  open,
  focused,
  onToggle,
}: {
  skill: LearnedSkill;
  events: LearningEvent[];
  open: boolean;
  focused: boolean;
  onToggle: () => void;
}) {
  const state = useSkillState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused]);
  const origin = OWN.has(skill.source) ? skillOrigin(events, skill.name) : null;
  const meta = [origin?.label ?? sourceWord(skill), skill.category].filter(Boolean).join(" · ");
  const setEnabled = (next: boolean) =>
    state.mutate(
      { name: skill.name, state: next ? "enable" : "disable" },
      {
        onError: (err) => useToastStore.getState().show(errorText(err, "Couldn't change that skill.")),
      },
    );
  return (
    <div ref={ref} className={cn(focused && "bg-primary/5")} data-testid={`skill-${skill.name}`}>
      <div className="flex min-h-12 items-center gap-2.5 px-3.5 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-foreground">{skill.name}</span>
              {skill.restored && <Tag tone="warning">{RESTORED_REVIEW}</Tag>}
              {skill.locked && <Tag>Locked</Tag>}
              {skill.archived && <Tag>Archived</Tag>}
              {skill.stale && !skill.archived && <Tag>Unused</Tag>}
            </span>
            <span className="truncate text-xs text-muted-foreground">{meta}</span>
          </span>
        </button>
        <ListSwitch
          checked={skill.enabled}
          onChange={setEnabled}
          disabled={state.isPending || skill.archived}
          label={`Use ${skill.name}`}
        />
      </div>
      {open && <SkillDetail skill={skill} events={events} originChat={origin?.conversationId ?? ""} />}
    </div>
  );
}

const ACTION_WORDS: Record<string, string> = {
  create: "Created",
  created: "Created",
  patch: "Changed",
  patched: "Changed",
  edit: "Edited",
  edited: "Edited",
  write_file: "Changed a file",
  remove_file: "Removed a file",
  delete: "Deleted",
  rollback: "Undone",
  archive: "Archived",
  restore: "Restored",
};

/** Archive works only for a learned skill; a built-in one is turned off with its switch. */
function canArchive(skill: LearnedSkill) {
  return skill.archivable ?? skill.source === "learned";
}

function actorWord(actor: string) {
  return actor === "user" ? "you" : "Timely";
}

function SkillDetail({
  skill,
  events,
  originChat,
}: {
  skill: LearnedSkill;
  events: LearningEvent[];
  originChat: string;
}) {
  const detail = useLearnedSkill(skill.name);
  const edit = useEditSkill();
  const state = useSkillState();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const readOnly = skill.source === "timely";

  async function save() {
    if (draft === null) return;
    setError("");
    try {
      await edit.mutateAsync({ name: skill.name, content: draft });
      setDraft(null);
    } catch (err) {
      setError(errorText(err, "Couldn't save the skill."));
    }
  }
  function change(next: SkillState) {
    setError("");
    state.mutate(
      { name: skill.name, state: next },
      { onError: (err) => setError(errorText(err, "Couldn't change that skill.")) },
    );
  }
  const resets = skill.source === "edited";
  function remove() {
    requestConfirm({
      title: resets ? `Remove your changes to “${skill.name}”?` : `Delete “${skill.name}”?`,
      description: resets
        ? "The built-in skill comes back as it shipped. Undo in Activity brings your changes back."
        : "Timely forgets this skill. Download what Timely learned first if you want a copy.",
      confirmLabel: resets ? "Remove changes" : "Delete",
      pendingLabel: resets ? "Removing…" : "Deleting…",
      onConfirm: async () => {
        try {
          await state.mutateAsync({ name: skill.name, state: "delete" });
        } catch (err) {
          useToastStore.getState().show(errorText(err, "Couldn't delete that skill."));
        }
      },
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-muted/20 px-3.5 py-3">
      {originChat && (
        <p className="text-xs text-muted-foreground">
          From{" "}
          <Link href={`/chat?id=${encodeURIComponent(originChat)}`} className="font-medium text-primary hover:underline">
            the chat it was learned in
          </Link>
        </p>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1">
          {draft === null && !skill.archived ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!detail.data || skill.locked}
              onClick={() => setDraft(detail.data?.content ?? "")}
            >
              Edit
            </Button>
          ) : null}
          {!skill.archived && (
            <Button variant="ghost" size="sm" disabled={state.isPending} onClick={() => change(skill.locked ? "unlock" : "lock")}>
              {skill.locked ? "Unlock" : "Lock"}
            </Button>
          )}
          {skill.archived ? (
            <Button variant="ghost" size="sm" disabled={state.isPending} onClick={() => change("restore")}>
              Restore
            </Button>
          ) : (
            canArchive(skill) && (
              <Button variant="ghost" size="sm" disabled={state.isPending || skill.locked} onClick={() => change("archive")}>
                Archive
              </Button>
            )
          )}
          {OWN.has(skill.source) && (
            <Button
              variant="destructive-ghost"
              size="sm"
              disabled={state.isPending || skill.locked}
              onClick={remove}
            >
              {resets ? "Remove my changes" : "Delete"}
            </Button>
          )}
        </div>
      )}
      {skill.locked && !readOnly && (
        <p className="text-xs text-muted-foreground">
          Locked: Timely doesn&apos;t change it. Unlock it to edit, archive or delete it.
        </p>
      )}
      {detail.isPending ? (
        <SkeletonLines lines={4} />
      ) : detail.error ? (
        <div className="-mx-3.5">
          <ErrorRow error={detail.error} what="this skill" onRetry={() => void detail.refetch()} />
        </div>
      ) : draft !== null ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label={`Edit ${skill.name}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-60 font-mono text-xs leading-5"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" loading={edit.isPending} disabled={!draft.trim()} onClick={() => void save()}>
              Save
            </Button>
            <Button variant="ghost" size="sm" disabled={edit.isPending} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card px-3 py-2 font-mono text-xs leading-5 text-foreground">
          {detail.data?.content || "This skill is empty."}
        </pre>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!!detail.data?.history?.length && (
        <div>
          <p className="pb-1.5 text-xs font-medium text-muted-foreground">History</p>
          <ListGroup>
            {detail.data.history.map((entry) => (
              <HistoryRow key={entry.id} skill={skill.name} entry={entry} events={events} />
            ))}
          </ListGroup>
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  skill,
  entry,
  events,
}: {
  skill: string;
  entry: SkillHistoryEntry;
  events: LearningEvent[];
}) {
  const [open, setOpen] = useState(false);
  const diff = useLearnedSkill(open ? skill : null, entry.id);
  const undo = useUndoLearning();
  // Undo goes through the change's event, which records that it was undone.
  const event = events.find((ev) => ev.ledgerEntryId === entry.id);
  const undoable = event && (event.status === "applied" || event.status === "kept");
  return (
    <div className="px-3.5 py-1.5">
      <div className="flex min-h-8 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px]">
          <span className="font-medium">{ACTION_WORDS[entry.action] ?? entry.action}</span>
          <span className="text-muted-foreground">
            {" "}
            by {actorWord(entry.actor)}
            {when(entry.ts) ? ` · ${when(entry.ts)}` : ""}
          </span>
          {event?.status === "undone" && <span className="text-muted-foreground"> · Undone</span>}
        </span>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide diff" : "Diff"}
        </Button>
        {undoable && (
          <Button
            variant="ghost"
            size="sm"
            loading={undo.isPending}
            onClick={() =>
              undo.mutate(event.id, {
                onError: (err) => useToastStore.getState().show(errorText(err, "Couldn't undo that.")),
              })
            }
          >
            Undo
          </Button>
        )}
      </div>
      {open &&
        (diff.isPending ? (
          <SkeletonLines lines={3} className="my-1.5" />
        ) : diff.error ? (
          <p role="alert" className="pb-1.5 text-xs text-destructive">
            {errorText(diff.error, "Couldn't load the diff.")}
          </p>
        ) : (
          <DiffView diff={diff.data?.diff ?? ""} className="mb-1.5" />
        ))}
    </div>
  );
}

/** "Updated upstream": built-in skills the person changed whose shipped copy changed since. */
function UpstreamGroup() {
  const upstream = useUpstream();
  // A worker without the upstream list yet answers "needs a newer agent
  // runtime"; there is nothing to show then.
  if (upstream.error || !upstream.data?.length) return null;
  return (
    <div data-testid="learned-upstream">
      <GroupLabel aside={`${upstream.data.length}`}>{UPDATED_UPSTREAM}</GroupLabel>
      <ListGroup>
        {upstream.data.map((item) => (
          <UpstreamRow key={item.name} name={item.name} changedAt={item.upstream_changed_at} />
        ))}
      </ListGroup>
      <GroupHint>
        You changed these built-in skills, and Timely has a newer version. Keep yours, or use the new one (your changes
        go).
      </GroupHint>
    </div>
  );
}

function UpstreamRow({ name, changedAt }: { name: string; changedAt: string }) {
  const [open, setOpen] = useState(false);
  const compare = useUpstreamCompare(open ? name : null);
  const choose = useChooseUpstream();
  const pick = (choice: "keep_mine" | "use_new") =>
    choose.mutate(
      { name, choice },
      { onError: (err) => useToastStore.getState().show(errorText(err, "Couldn't save that.")) },
    );
  return (
    <div className="px-3.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="min-w-0 flex-1 basis-48">
          <span className="block truncate text-[13px] font-medium">{name}</span>
          <span className="block text-xs text-muted-foreground">
            New version{when(changedAt) ? ` from ${when(changedAt)}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            Compare
          </Button>
          <Button variant="ghost" size="sm" disabled={choose.isPending} onClick={() => pick("keep_mine")}>
            Keep mine
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={choose.isPending && choose.variables?.choice === "use_new"}
            disabled={choose.isPending}
            onClick={() => pick("use_new")}
          >
            Use new
          </Button>
        </span>
      </div>
      {open &&
        (compare.isPending ? (
          <SkeletonLines lines={3} className="mt-2" />
        ) : compare.error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {errorText(compare.error, "Couldn't compare them.")}
          </p>
        ) : (
          <DiffView diff={compare.data?.diff ?? ""} className="mt-2" />
        ))}
    </div>
  );
}
