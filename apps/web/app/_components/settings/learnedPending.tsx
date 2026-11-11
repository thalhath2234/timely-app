"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  WAITING_FOR_YOU,
  cardLine,
  pendingItemWhy,
  type LearningEvent,
} from "@timely/contract/agentLearning";
import Button from "@/app/_components/_ui/button";
import { GroupHint, GroupLabel, ListGroup } from "@/app/_components/_ui/groupedList";
import { SkeletonLines } from "@/app/_components/_ui/skeleton";
import DiffView from "@/app/_components/chat/diffView";
import { cn } from "@/app/utils/cn";
import { useDecidePending, usePending, useStagedLearning } from "@/app/utils/hooks/learning";
import { ErrorRow, errorText, when } from "./learnedShared";

/**
 * Waiting for you: changes the agent saved for the person to confirm
 * (Q-3.1: the chat read outside content, or a bot suggested it). Each has
 * its diff, Keep and Discard. Shown only while something waits.
 */
export default function LearnedPending() {
  const staged = useStagedLearning();
  const events = (staged.data ?? []).filter((ev) => ev.pendingId);
  if (staged.error)
    return (
      <section aria-label={WAITING_FOR_YOU}>
        <GroupLabel>{WAITING_FOR_YOU}</GroupLabel>
        <ListGroup>
          <ErrorRow
            error={staged.error}
            what="what waits for you"
            onRetry={() => void staged.refetch()}
            retrying={staged.isFetching}
          />
        </ListGroup>
      </section>
    );
  if (!events.length) return null;
  return (
    <section aria-label={WAITING_FOR_YOU} id="learned-waiting" data-testid="learned-waiting">
      <GroupLabel aside={`${events.length}`}>{WAITING_FOR_YOU}</GroupLabel>
      <ListGroup>
        {events.map((ev) => (
          <PendingRow key={ev.id} event={ev} />
        ))}
      </ListGroup>
      <GroupHint>Nothing is used until you keep it.</GroupHint>
    </section>
  );
}

function PendingRow({ event }: { event: LearningEvent }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const decide = useDecidePending();
  const pending = usePending(open);
  const diff = pending.data?.find((item) => item.pending_id === event.pendingId)?.diff ?? "";
  async function choose(choice: "keep" | "discard") {
    setError("");
    try {
      await decide.mutateAsync({ pendingId: event.pendingId, choice });
    } catch (err) {
      setError(errorText(err, "Couldn't save that."));
    }
  }
  // Each change gives its own reason: the list mixes chats.
  const from = [event.summary, pendingItemWhy(event), when(event.createdAt)].filter(Boolean);
  const line = cardLine(event);
  return (
    <div className="px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="min-w-0 flex-1 basis-56">
          <span className="block text-[13px] font-medium leading-[18px]">{line}</span>
          <span className="block text-xs leading-4 text-muted-foreground">
            {from.join(" · ")}
            {event.conversationId ? (
              <>
                {" · "}
                <Link href={`/chat?id=${encodeURIComponent(event.conversationId)}`} className="text-primary hover:underline">
                  Open the chat
                </Link>
              </>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={`waiting-diff-${event.id}`}
            aria-label={`View diff: ${line}`}
            onClick={() => setOpen(!open)}
            leading={<ChevronRight aria-hidden className={cn("transition-transform", open && "rotate-90")} />}
          >
            View diff
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={decide.isPending}
            aria-label={`Discard: ${line}`}
            onClick={() => void choose("discard")}
          >
            Discard
          </Button>
          <Button
            size="sm"
            loading={decide.isPending && decide.variables?.choice === "keep"}
            disabled={decide.isPending}
            aria-label={`Keep: ${line}`}
            onClick={() => void choose("keep")}
          >
            Keep
          </Button>
        </span>
      </div>
      {open && (
        <div id={`waiting-diff-${event.id}`}>
          {pending.isPending ? (
            <SkeletonLines lines={3} className="mt-2" />
          ) : pending.error ? (
            <div className="-mx-3.5 mt-1">
              <ErrorRow error={pending.error} what="the change" onRetry={() => void pending.refetch()} />
            </div>
          ) : (
            <DiffView diff={diff} className="mt-2" />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
