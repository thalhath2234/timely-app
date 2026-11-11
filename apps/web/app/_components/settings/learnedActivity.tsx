"use client";
import Link from "next/link";
import { BookOpen, Lightbulb, UserRound } from "lucide-react";
import {
  ACTIVITY,
  canUndoLearning,
  cardLine,
  statusWord,
  type LearningEvent,
} from "@timely/contract/agentLearning";
import Button from "@/app/_components/_ui/button";
import { GroupHint, GroupLabel, ListGroup } from "@/app/_components/_ui/groupedList";
import { SkeletonRows } from "@/app/_components/_ui/skeleton";
import { cn } from "@/app/utils/cn";
import { useLearningActivity, useUndoLearning } from "@/app/utils/hooks/learning";
import { EmptyRow, ErrorRow, Tag, confirmUndo, when } from "./learnedShared";

const ORIGIN: Record<string, string> = {
  chat: "in a chat",
  review: "after a chat",
  bot: "from a bot",
  user: "by you",
  curator: "by Timely",
  sync: "with an update",
  restore: "from a backup",
};

/** Activity: every change, newest first, with Undo on what can still be taken back. */
export default function LearnedActivity() {
  const feed = useLearningActivity();
  const events = feed.data?.pages.flat() ?? [];
  return (
    <section aria-label={ACTIVITY} id="learned-activity" data-testid="learned-activity">
      <GroupLabel>{ACTIVITY}</GroupLabel>
      <ListGroup>
        {feed.isPending ? (
          <div className="px-3.5 py-2.5">
            <SkeletonRows rows={4} />
          </div>
        ) : feed.error && !events.length ? (
          <ErrorRow error={feed.error} what="activity" onRetry={() => void feed.refetch()} retrying={feed.isFetching} />
        ) : events.length === 0 ? (
          <EmptyRow>Nothing yet. Each change Timely makes to its skills and notes shows here.</EmptyRow>
        ) : (
          [
            ...events.map((ev) => <ActivityRow key={ev.id} event={ev} events={events} />),
            ...(feed.hasNextPage
              ? [
                  <div key="more" className="flex justify-center px-3.5 py-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={feed.isFetchingNextPage}
                      onClick={() => void feed.fetchNextPage()}
                    >
                      Show earlier
                    </Button>
                  </div>,
                ]
              : []),
          ]
        )}
      </ListGroup>
      <GroupHint>Undo puts a skill or note back the way it was before that change.</GroupHint>
    </section>
  );
}

function ActivityRow({ event, events }: { event: LearningEvent; events: LearningEvent[] }) {
  const undo = useUndoLearning();
  const run = () => confirmUndo(event, events, undo.mutateAsync);
  const Icon = event.kind === "skill" ? Lightbulb : event.kind === "user" ? UserRound : BookOpen;
  const live = canUndoLearning(event);
  const blocked = event.status === "blocked";
  const meta = [ORIGIN[event.origin] ?? "", when(event.createdAt)].filter(Boolean).join(" · ");
  return (
    <div className="flex min-h-12 items-center gap-2.5 px-3.5 py-1.5">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-[8px]",
          blocked ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
        )}
      >
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate text-[13px] font-medium",
            (event.status === "undone" || event.status === "discarded") && "text-muted-foreground line-through",
          )}
        >
          {cardLine(event)}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {event.summary ? `${event.summary} · ` : ""}
          {meta}
          {event.conversationId ? (
            <>
              {" · "}
              <Link href={`/chat?id=${encodeURIComponent(event.conversationId)}`} className="text-primary hover:underline">
                Chat
              </Link>
            </>
          ) : null}
        </span>
      </span>
      {live ? (
        <Button
          variant="ghost"
          size="sm"
          loading={undo.isPending}
          aria-label={`Undo: ${cardLine(event)}`}
          onClick={run}
        >
          Undo
        </Button>
      ) : (
        <Tag tone={event.status === "staged" ? "warning" : "muted"}>{statusWord(event.status)}</Tag>
      )}
    </div>
  );
}

