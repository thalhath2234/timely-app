"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  FEEDBACK_REASONS,
  type AlertBrief,
  type FeedbackInput,
  type FeedbackReason,
} from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { Input, popoverSurface } from "@/app/_components/_ui/field";
import { GroupLabel } from "@/app/_components/_ui/groupedList";
import { PopoverView } from "@/app/_components/_ui/motion";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { useRateAlert } from "@/app/utils/hooks/bots";
import { cn } from "@/app/utils/cn";

const NOTE_MAX = 200;

/**
 * "Was it worth it?" on an alert: Useful, or Not useful with why. The answer
 * saves at once and the toast can take it back. `icon` is the compact
 * card's pair of 28 px icon buttons.
 */
export function AlertFeedback({
  botId,
  alert,
  size = "default",
  align = "start",
}: {
  botId: string;
  alert: Pick<AlertBrief, "id" | "feedback">;
  size?: "default" | "icon";
  /** Which edge the "Why not?" popover lines up with. */
  align?: "start" | "end";
}) {
  const rate = useRateAlert();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FeedbackReason>("");
  const [note, setNote] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const send = (body: FeedbackInput, thanks: string | null) =>
    rate.mutate(
      { botId, alertId: alert.id, body },
      {
        onSuccess: () => {
          setOpen(false);
          if (thanks)
            showUndoToast(thanks, () =>
              rate.mutate(
                { botId, alertId: alert.id, body: { feedback: null } },
                {
                  onError: (error) =>
                    useToastStore.getState().show(error.message),
                },
              ),
            );
        },
        onError: (error) => useToastStore.getState().show(error.message),
      },
    );

  const useful = alert.feedback === "useful";
  const notUseful = alert.feedback === "not_useful";
  const icon = size === "icon";
  const chosen =
    "border-transparent bg-accent text-accent-foreground shadow-none hover:bg-accent";
  const iconClass =
    "size-7 border border-border bg-card text-foreground shadow-none hover:bg-muted";

  return (
    <div ref={root} className="relative z-[1] flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        icon={icon}
        aria-label={icon ? "Useful" : undefined}
        aria-pressed={useful}
        disabled={rate.isPending}
        className={cn(icon && iconClass, useful && chosen)}
        leading={useful ? <Check /> : <ThumbsUp />}
        onClick={() =>
          useful
            ? send({ feedback: null }, null)
            : send({ feedback: "useful" }, "Saved: this alert helped")
        }
      >
        {icon ? null : "Useful"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        icon={icon}
        aria-label={icon ? "Not useful" : undefined}
        aria-pressed={notUseful}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={rate.isPending}
        className={cn(icon && iconClass, notUseful && chosen)}
        leading={notUseful ? <Check /> : <ThumbsDown />}
        onClick={() =>
          notUseful ? send({ feedback: null }, null) : setOpen((was) => !was)
        }
      >
        {icon ? null : "Not useful"}
      </Button>
      {useful && !icon ? (
        <span className="text-xs text-muted-foreground">
          You said this helped
        </span>
      ) : null}
      {notUseful && !icon ? (
        <span className="text-xs text-muted-foreground">
          You said it didn’t help
        </span>
      ) : null}
      {open ? (
        <PopoverView>
          <div
            role="dialog"
            aria-label="Why not?"
            className={cn(
              popoverSurface,
              "absolute top-9 z-40 flex w-72 flex-col gap-2.5 p-3",
              align === "end" ? "right-0" : "left-0",
            )}
          >
            <GroupLabel className="pb-0">Why not?</GroupLabel>
            <div className="flex flex-wrap gap-1.5">
              {FEEDBACK_REASONS.map((r) => {
                const on = reason === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setReason(on ? "" : r.id)}
                    className={cn(
                      "inline-flex h-7 cursor-pointer items-center rounded-full border px-2.5 text-[13px] transition-colors",
                      on
                        ? "border-ring bg-primary font-semibold text-primary-foreground"
                        : "border-border bg-card font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <Input
              size="sm"
              value={note}
              maxLength={NOTE_MAX}
              placeholder="Anything else? (optional)"
              aria-label="Anything else? (optional)"
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                loading={rate.isPending}
                onClick={() =>
                  send(
                    { feedback: "not_useful", reason, note: note.trim() },
                    "Saved: this alert didn’t help",
                  )
                }
              >
                Send
              </Button>
            </div>
          </div>
        </PopoverView>
      ) : null}
    </div>
  );
}
