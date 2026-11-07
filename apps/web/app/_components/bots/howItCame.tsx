"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Unlink, ThumbsDown } from "lucide-react";
import {
  PASS_FEEDBACK,
  howItCame,
  type AlertBrief,
  type AlertView,
  type BotView,
  type LinkView,
} from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { popoverSurface } from "@/app/_components/_ui/field";
import {
  GroupLabel,
  ListGroup,
  ListRow,
} from "@/app/_components/_ui/groupedList";
import { PopoverView } from "@/app/_components/_ui/motion";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { cn } from "@/app/utils/cn";
import { useBots, useRateAlert, useSetLink } from "@/app/utils/hooks/bots";

const say = (message: string) => {
  useToastStore.getState().show(message);
};

/**
 * "How this came to you" under an alert in the rail: which bots found and
 * passed it on, which bot checked it, and whether AI judged it. An alert
 * that came through a link that is still on can be marked "Shouldn't have
 * been passed on", or that pass turned off.
 */
export function HowItCame({
  bot,
  alert,
  links,
}: {
  bot: Pick<BotView, "id" | "name">;
  alert: Pick<AlertBrief, "id" | "via" | "aiState" | "feedback"> &
    Partial<Pick<AlertView, "feedbackReason">>;
  links: LinkView[] | null | undefined;
}) {
  const bots = useBots().data?.bots;
  const rate = useRateAlert();
  const setLink = useSetLink();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape closes the popover, not the panel it sits in.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const { rows, unpass } = howItCame(alert, bot, bots, links);
  const target = unpass
    ? (links ?? []).find((l) => l.id === unpass.linkId)
    : undefined;
  const from = target
    ? (bots?.find((b) => b.id === target.fromBotId)?.name ?? "the bot")
    : "the bot";
  // Only a Not useful for this reason; another reason can still be re-rated.
  const markedNotPassed =
    alert.feedback === "not_useful" &&
    alert.feedbackReason === PASS_FEEDBACK.id;

  const notPassed = () =>
    rate.mutate(
      {
        botId: bot.id,
        alertId: alert.id,
        body: { feedback: "not_useful", reason: PASS_FEEDBACK.id },
      },
      {
        onSuccess: () => setOpen(false),
        onError: (error) => say(error.message),
      },
    );

  const turnOff = () => {
    if (!unpass) return;
    requestConfirm({
      title: `Stop ${from} passing items to ${bot.name}?`,
      description:
        "Its finds then come straight to you again. You can turn the pass back on from either bot.",
      confirmLabel: "Turn off",
      pendingLabel: "Turning off…",
      onConfirm: () =>
        setLink
          .mutateAsync({ linkId: unpass.linkId, enabled: false, botId: bot.id })
          .then(
            () => {
              setOpen(false);
              say("Pass turned off");
            },
            (error: Error) => {
              say(error.message);
            },
          ),
    });
  };

  return (
    // While open it sits above the alerts under it in the list.
    <div ref={root} className={cn("relative w-full", open && "z-30")}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1 -ml-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground [&_svg]:size-3"
      >
        How this came to you
        <ChevronDown
          aria-hidden
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <PopoverView>
          <div
            role="dialog"
            aria-label="How this came to you"
            className={cn(
              popoverSurface,
              "absolute inset-x-0 top-8 z-40 flex min-w-64 flex-col gap-2.5 p-3",
            )}
          >
            <GroupLabel className="pb-0">How this came to you</GroupLabel>
            <ListGroup>
              {rows.map(([label, value], i) => (
                <ListRow key={`${i}-${label}`} label={label}>
                  <span className="min-w-0 break-words py-2 text-right text-[13px] font-medium text-muted-foreground">
                    {value}
                  </span>
                </ListRow>
              ))}
            </ListGroup>
            {unpass ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  leading={<ThumbsDown />}
                  aria-pressed={markedNotPassed}
                  loading={rate.isPending}
                  disabled={markedNotPassed}
                  onClick={notPassed}
                >
                  {PASS_FEEDBACK.label}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leading={<Unlink />}
                  loading={setLink.isPending}
                  onClick={turnOff}
                >
                  Turn off this pass
                </Button>
              </div>
            ) : null}
          </div>
        </PopoverView>
      ) : null}
    </div>
  );
}
