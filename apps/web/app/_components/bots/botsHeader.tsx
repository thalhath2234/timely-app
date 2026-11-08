"use client";

import { MessageCircle, Plus } from "lucide-react";
import { summaryLine, type BotsList } from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import PageHeader, { PageBadge } from "@/app/_components/_ui/pageHeader";

/** "Bots 9", today's checks and alerts, and the two ways to make a bot. */
export function BotsHeader({
  list,
  now,
  onNew,
  onDescribe,
}: {
  list: BotsList | undefined;
  now: Date | null;
  onNew: () => void;
  onDescribe: () => void;
}) {
  // Both wait for the clock, which is null until hydration is over, so the
  // server's HTML (no bots yet) and the first client render match.
  const count = now ? (list?.bots.length ?? 0) : 0;
  return (
    <PageHeader
      title="Bots"
      badge={count ? <PageBadge>{count}</PageBadge> : undefined}
      description={
        list && count && now ? (
          <span className="tabular-nums">{summaryLine(list, now)}</span>
        ) : undefined
      }
      actions={
        <>
          <Button
            variant="outline"
            size="md"
            leading={<MessageCircle />}
            onClick={onDescribe}
          >
            Describe in chat
          </Button>
          <Button
            variant="primary"
            size="md"
            leading={<Plus />}
            onClick={onNew}
          >
            New bot
          </Button>
        </>
      }
    />
  );
}
