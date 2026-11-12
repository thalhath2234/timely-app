"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Lightbulb, Undo2 } from "lucide-react";
import {
  chipUndoAlso,
  type LearningChip,
  type PendingCard,
} from "@timely/contract/agentLearning";
import Button from "@/app/_components/_ui/button";
import { SkeletonLines } from "@/app/_components/_ui/skeleton";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { requestConfirm } from "@/app/_store/confirmStore";
import { listLearningEvents } from "@/app/utils/api/learning";
import { cn } from "@/app/utils/cn";
import {
  useDecidePending,
  usePending,
  useUndoLearning,
} from "@/app/utils/hooks/learning";
import DiffView from "./diffView";
import { learnedHref } from "./learningView";

/**
 * What one agent turn learned (plan 9b.4, Q-3.1), after its reply: the
 * chip for what was learned in a clean chat ("Learned: skill
 * 'bank-csv-import' created · View · Undo") and, when the chat read
 * outside content or a bot wrote it, the "Keep what Timely learned?" card.
 */
export default function TurnLearning({
  turn,
  onLeave,
}: {
  /** The turn's chip and card (turnLearning, or looseLearning for a run that wrote no reply). */
  turn: { chip: LearningChip | null; card: PendingCard | null };
  /** Called before View leaves the chat (the overlay closes). */
  onLeave?: () => void;
}) {
  const { chip, card } = turn;
  if (!chip && !card) return null;
  return (
    <div className="flex flex-col gap-2.5" data-testid="turn-learning">
      {chip && <Chip chip={chip} onLeave={onLeave} />}
      {card && <StagedCard card={card} />}
    </div>
  );
}

const textButton =
  "inline-flex h-6 shrink-0 cursor-pointer items-center rounded-md px-1.5 font-medium text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50";

function Chip({ chip, onLeave }: { chip: LearningChip; onLeave?: () => void }) {
  const undo = useUndoLearning();
  const [error, setError] = useState("");
  const undone = chip.actions.length === 0;
  const [checking, setChecking] = useState(false);
  async function undoAll() {
    setError("");
    try {
      // One change at a time: each is its own history entry.
      for (const id of chip.eventIds) await undo.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't undo that.");
    }
  }
  // Undo of a skill change also takes back later changes to that skill
  // (the person's own edits in Settings included): say so first, as
  // Settings does. Those changes are outside this chat, so ask the
  // account's recent ones.
  async function askUndo() {
    setError("");
    setChecking(true);
    let also = "";
    try {
      also = chipUndoAlso(
        await listLearningEvents({ limit: 200 }),
        chip.eventIds,
      );
    } catch {
      also = "";
    } finally {
      setChecking(false);
    }
    if (!also) return void undoAll();
    requestConfirm({
      title: "Undo what Timely learned?",
      description: also,
      confirmLabel: "Undo",
      pendingLabel: "Undoing…",
      tone: "primary",
      icon: <Undo2 aria-hidden className="size-4" />,
      onConfirm: undoAll,
    });
  }
  return (
    <div className="flex flex-col gap-1">
      <div
        role="status"
        aria-label={chip.text}
        data-testid="learning-chip"
        className={cn(
          "inline-flex w-fit max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-[14px] bg-muted py-0.5 pl-2.5 pr-1 text-xs",
          undone && "pr-2.5",
        )}
      >
        {/* The icon stays with the label; the note and the actions wrap
            as one group, so a narrow chat keeps one compact chip. */}
        <span className="inline-flex min-w-0 items-start gap-1">
          {undone ? (
            <Undo2
              aria-hidden
              className="mt-[3px] size-3.5 shrink-0 text-muted-foreground"
            />
          ) : (
            <Lightbulb
              aria-hidden
              className="mt-[3px] size-3.5 shrink-0 text-primary"
            />
          )}
          <span
            className={cn(
              "min-w-0 py-0.5 font-medium",
              undone ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {chip.label}
          </span>
        </span>
        <span className="inline-flex flex-wrap items-center gap-x-1">
          {chip.note && (
            <span className="text-muted-foreground">· {chip.note}</span>
          )}
          {chip.view && (
            <Link
              href={learnedHref(chip.view)}
              onClick={onLeave}
              className={textButton}
            >
              View
            </Link>
          )}
          {chip.actions.includes("Undo") && (
            <button
              type="button"
              disabled={undo.isPending || checking}
              onClick={() => void askUndo()}
              aria-label={`Undo: ${chip.label}`}
              className={textButton}
            >
              {undo.isPending || checking ? (
                <LogoSpinner size={12} tone="mono" label="Undoing" />
              ) : (
                "Undo"
              )}
            </button>
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="pl-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The card of staged changes, as drawn in option 1: Keep or Discard each. */
export function StagedCard({ card }: { card: PendingCard }) {
  const decide = useDecidePending();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  // The diffs come from the agent; fetched only once one is opened.
  const pending = usePending(open !== null);
  const diffOf = (pendingId: string) =>
    pending.data?.find((item) => item.pending_id === pendingId)?.diff ?? "";
  async function choose(pendingId: string, choice: "keep" | "discard") {
    setError("");
    try {
      await decide.mutateAsync({ pendingId, choice });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    }
  }
  return (
    <section
      aria-label={card.title}
      data-testid="learning-card"
      className="max-w-full overflow-hidden rounded-xl border border-border bg-card sm:max-w-[86%]"
    >
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
          <Lightbulb aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-[18px]">
            {card.title}
          </span>
          <span className="block text-xs leading-4 text-muted-foreground">
            {card.why}
          </span>
        </span>
      </div>
      {card.items.map((item) => {
        const shown = open === item.pendingId;
        const deciding =
          decide.isPending && decide.variables?.pendingId === item.pendingId;
        return (
          <div
            key={item.eventId}
            className="border-t border-border px-3.5 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block text-[13px] font-medium leading-[18px]">
                  {item.line}
                </span>
                {item.summary && (
                  <span className="block text-xs leading-4 text-muted-foreground">
                    {item.summary}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={shown}
                  aria-controls={`learning-diff-${item.eventId}`}
                  aria-label={`${card.viewDiff}: ${item.line}`}
                  onClick={() => setOpen(shown ? null : item.pendingId)}
                  leading={
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        "transition-transform",
                        shown && "rotate-90",
                      )}
                    />
                  }
                >
                  {card.viewDiff}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={decide.isPending}
                  aria-label={`${card.discard}: ${item.line}`}
                  onClick={() => void choose(item.pendingId, "discard")}
                >
                  {card.discard}
                </Button>
                <Button
                  size="sm"
                  loading={deciding && decide.variables?.choice === "keep"}
                  disabled={decide.isPending}
                  aria-label={`${card.keep}: ${item.line}`}
                  onClick={() => void choose(item.pendingId, "keep")}
                >
                  {card.keep}
                </Button>
              </span>
            </div>
            {shown && (
              <div id={`learning-diff-${item.eventId}`}>
                {pending.isPending ? (
                  <SkeletonLines lines={3} className="mt-2" />
                ) : pending.error ? (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {pending.error.message}
                  </p>
                ) : (
                  <DiffView diff={diffOf(item.pendingId)} className="mt-2" />
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && (
        <p
          role="alert"
          className="border-t border-border px-3.5 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </section>
  );
}
