"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Clock } from "lucide-react";
import { AGENT_STARTERS, starterAvailable } from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { GroupLabel } from "@/app/_components/_ui/groupedList";
import { SkeletonCards } from "@/app/_components/_ui/skeleton";
import type { AgentStarter } from "@/app/_types/types";
import { cn } from "@/app/utils/cn";
import { useNewBotDraft } from "@/app/utils/hooks/chat";
import { scheduleWords } from "./agentBot";
import { BotThread } from "./botThread";
import { CloseButton, PanelFrame, escapeCloses } from "./panelParts";
import type { Unfinished } from "./botPanel";

/**
 * The connectors this Timely has. Timely has no email or calendar connector
 * yet, so a Starter that needs one stays off and says what it needs.
 */
export const CONNECTORS: readonly string[] = [];

/** The first message of a Bot that starts from a Starter. */
export function starterRequest(starter: AgentStarter): string {
  return `Make a bot: ${starter.title}. ${starter.prompt} It runs ${scheduleWords(starter.schedule).toLowerCase()}.`;
}

/** A Starter by its blueprint key, when it can be started now. */
export function startableStarter(
  key: string | null | undefined,
): AgentStarter | undefined {
  const found = AGENT_STARTERS.find((s) => s.key === key);
  return found && starterAvailable(found, CONNECTORS).available
    ? found
    : undefined;
}

function StarterCard({
  starter,
  busy,
  onUse,
}: {
  starter: AgentStarter;
  busy: boolean;
  onUse: (starter: AgentStarter) => void;
}) {
  const { available, copy } = starterAvailable(starter, CONNECTORS);
  return (
    <article
      className="flex min-w-0 flex-col rounded-[12px] border border-border bg-card"
      data-testid={`starter-${starter.key}`}
      data-available={available}
    >
      <div
        className={cn(
          "flex flex-1 flex-col gap-1.5 p-3.5",
          !available && "opacity-70",
        )}
      >
        <p className="truncate text-sm font-semibold text-foreground">
          {starter.title}
        </p>
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          {scheduleWords(starter.schedule)}
        </p>
        <p className="text-[13px] leading-5 text-muted-foreground">
          {starter.prompt}
        </p>
      </div>
      <div className="flex min-h-11 items-center gap-2 border-t border-border px-3.5 py-2">
        <span className="min-w-0 flex-1 text-xs leading-4 text-muted-foreground">
          {copy ?? "Opens a thread with the setup ready"}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!available || busy}
          onClick={() => onUse(starter)}
        >
          Use
        </Button>
      </div>
    </article>
  );
}

/** Every Starter, one per Hermes blueprint; one that needs a connector Timely lacks is off. */
export function AgentStarterGrid({
  busy,
  onUse,
}: {
  busy: boolean;
  onUse: (starter: AgentStarter) => void;
}) {
  return (
    <section>
      <GroupLabel aside={`${AGENT_STARTERS.length}`}>Starters</GroupLabel>
      <div className="grid gap-3 @[640px]:grid-cols-2 @[960px]:grid-cols-3">
        {AGENT_STARTERS.map((starter) => (
          <StarterCard
            key={starter.key}
            starter={starter}
            busy={busy}
            onUse={onUse}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * New bot: a Bot starts as its thread. Describe it, or pick a Starter; the
 * thread then shows its whole setup for one Create.
 */
export function NewBotThread({
  starter,
  onClose,
  onCreated,
  onUnfinished,
}: {
  /** A Starter's key from ?new=1&starter=<key>. */
  starter?: string | null;
  onClose: () => void;
  onCreated: (botId: string) => void;
  onUnfinished?: (unfinished: Unfinished) => void;
}) {
  const start = useNewBotDraft();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const frameRef = useRef<HTMLElement>(null);
  const begun = useRef(false);

  const begin = (content: string) =>
    start.mutate(content, {
      onSuccess: (view) => setDraftId(view.thread.id),
    });

  // A Starter's link opens its draft thread at once.
  useEffect(() => {
    const found = startableStarter(starter);
    if (!found || begun.current) return;
    begun.current = true;
    begin(starterRequest(found));
    // Only when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    frameRef.current?.focus({ preventScroll: true });
  }, []);

  const touched = !!draftId || !!text.trim();
  useEffect(() => {
    onUnfinished?.(touched ? "new" : null);
  }, [touched, onUnfinished]);
  useEffect(() => () => onUnfinished?.(null), [onUnfinished]);

  return (
    <PanelFrame
      label="New bot"
      frameRef={frameRef}
      onKeyDown={escapeCloses(onClose)}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card py-4 pl-6 pr-5">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-fill text-muted-foreground"
        >
          <Bot className="size-5" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[22px] font-semibold leading-7 tracking-[-0.02em] text-foreground">
          New bot
        </h2>
        <CloseButton onClose={onClose} />
      </header>
      {draftId ? (
        <BotThread id={draftId} onCreated={onCreated} />
      ) : start.isPending ? (
        <div className="p-6">
          <SkeletonCards />
        </div>
      ) : (
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-w-0 flex-col gap-5 px-6 pb-6 pt-5">
            <section>
              <GroupLabel>Describe your bot</GroupLabel>
              <textarea
                aria-label="Describe your bot"
                rows={3}
                value={text}
                placeholder="Tell me when the price of this drops below ₹20,000"
                onChange={(event) => setText(event.target.value)}
                className="min-h-20 w-full rounded-[12px] border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring/50"
              />
              <div className="mt-2 flex items-center gap-3">
                <Button
                  disabled={!text.trim()}
                  onClick={() => begin(text.trim())}
                >
                  Start
                </Button>
                {start.error ? (
                  <p className="text-xs text-destructive">
                    {start.error.message}
                  </p>
                ) : null}
              </div>
            </section>
            <AgentStarterGrid
              busy={start.isPending}
              onUse={(s) => begin(starterRequest(s))}
            />
          </div>
        </div>
      )}
    </PanelFrame>
  );
}
