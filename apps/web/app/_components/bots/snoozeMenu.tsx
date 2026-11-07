"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlarmClockOff,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  maxSnoozeUntil,
  snoozeLabel,
  snoozePresets,
  type BotView,
} from "@timely/contract/bots";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import { DateTimePanel } from "@/app/_components/_ui/datePicker";
import { menuItemClass, popoverSurface } from "@/app/_components/_ui/field";
import { PopoverView } from "@/app/_components/_ui/motion";
import { useToastStore } from "@/app/_store/toastStore";
import type { SnoozeBody } from "@/app/utils/api/bots";
import { cn } from "@/app/utils/cn";
import { useSnoozeBot } from "@/app/utils/hooks/bots";

const say = (message: string) => useToastStore.getState().show(message);

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as the panel's local "YYYY-MM-DDTHH:mm". */
const localValue = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Mon 09:00" within a week, else "Nov 14, 09:00": when a snooze ends, never just a time. */
function untilLabel(at: Date, now: Date): string {
  const time = at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  if (at.getTime() - now.getTime() < 6 * 86_400_000) {
    return `${at.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  }
  return `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

/** Tomorrow at 09:00, the first time "Until a time" offers. */
function tomorrowMorning(now: Date): string {
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    9,
    0,
  );
  return localValue(d);
}

/**
 * Snooze: For a day, For a week, or Until a time, which swaps the menu for
 * Timely's own calendar and time steppers, with a Back arrow (no native
 * picker, and no popover opened from a popover). Checks keep
 * running while snoozed; alerts are kept on the bot instead of sent.
 */
export function SnoozeMenu({ bot, now }: { bot: BotView; now: Date }) {
  const snooze = useSnoozeBot();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setUntil(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape closes the menu, not the panel it sits in.
      event.stopPropagation();
      setOpen(false);
      setUntil(null);
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

  const snoozed = snoozeLabel(bot, now);
  const presets = snoozePresets(now);
  const max = maxSnoozeUntil(now);
  const send = (body: SnoozeBody) =>
    snooze.mutate(
      { id: bot.id, body },
      {
        onSuccess: (view) => {
          setOpen(false);
          setUntil(null);
          say(
            view.snoozedUntil
              ? `${bot.name}: snoozed until ${untilLabel(new Date(view.snoozedUntil), new Date())}`
              : `${bot.name}: alerts are on again`,
          );
        },
        onError: (error) => say(error.message),
      },
    );

  const picked = until ? new Date(until) : null;
  const pickedOk =
    !!picked &&
    !Number.isNaN(picked.getTime()) &&
    picked > now &&
    picked <= max;
  const pickedLabel = picked && pickedOk ? untilLabel(picked, now) : null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
          setUntil(null);
        }}
        className={buttonClass({
          variant: snoozed ? "secondary" : "outline",
          size: "sm",
        })}
      >
        <AlarmClockOff />
        <span className="tabular-nums">{snoozed ?? "Snooze"}</span>
        <ChevronDown className="text-muted-foreground" />
      </button>
      {open ? (
        <PopoverView>
          {until === null ? (
            <div
              role="menu"
              aria-label="Snooze"
              className={cn(
                popoverSurface,
                "absolute right-0 top-9 z-40 flex w-[300px] flex-col p-1.5",
              )}
            >
              {presets.map((p) => (
                <button
                  key={p.for}
                  type="button"
                  role="menuitem"
                  disabled={snooze.isPending}
                  onClick={() => send({ for: p.for })}
                  className={cn(
                    menuItemClass,
                    "h-9 justify-between hover:bg-muted",
                  )}
                >
                  <span className="font-medium">
                    {p.for === "day" ? "For a day" : "For a week"}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {p.label}
                  </span>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => setUntil(tomorrowMorning(now))}
                className={cn(
                  menuItemClass,
                  "h-9 justify-between hover:bg-muted",
                )}
              >
                <span className="font-medium">Until a time</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
              {snoozed ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={snooze.isPending}
                  onClick={() => send({ until: null })}
                  className={cn(
                    menuItemClass,
                    "h-9 font-medium hover:bg-muted",
                  )}
                >
                  Stop snoozing
                </button>
              ) : null}
              <div aria-hidden className="mx-2 my-1 h-px bg-border" />
              <p className="px-2 pb-1.5 pt-0.5 text-xs leading-relaxed text-muted-foreground">
                Checks keep running. Alerts are kept on the bot, not sent.
              </p>
            </div>
          ) : (
            // Until a time takes the menu's place, so it fits wherever the
            // menu does, even in a narrow panel.
            <div
              role="dialog"
              aria-label="Snooze until"
              className={cn(
                popoverSurface,
                "absolute right-0 top-9 z-40 w-[300px] p-3",
              )}
            >
              <div className="mb-2 flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label="Back to snooze"
                  onClick={() => setUntil(null)}
                >
                  <ArrowLeft />
                </Button>
                <span className="text-[13px] font-semibold">Snooze until</span>
              </div>
              <DateTimePanel
                value={until}
                onChange={(next) => setUntil(next || null)}
                min={now}
                max={max}
                action={
                  <Button
                    size="sm"
                    disabled={!pickedOk}
                    loading={snooze.isPending}
                    onClick={() =>
                      picked && send({ until: picked.toISOString() })
                    }
                  >
                    {pickedLabel
                      ? `Snooze until ${pickedLabel}`
                      : "Pick a later time"}
                  </Button>
                }
              />
            </div>
          )}
        </PopoverView>
      ) : null}
    </div>
  );
}
