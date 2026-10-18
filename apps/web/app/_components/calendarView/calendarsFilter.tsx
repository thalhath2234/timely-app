"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { buttonClass } from "@/app/_components/_ui/button";
import { popoverSurface } from "@/app/_components/_ui/field";
import { GroupLabel, ListGroup, ListRow, ListSwitch } from "@/app/_components/_ui/groupedList";
import { PopoverView } from "@/app/_components/_ui/motion";
import { swatchColor } from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";

/**
 * The legend as a filter: one button on the header line, a popover of
 * grouped rows with a switch per project or workspace on the calendar.
 * Hidden entries stay out of the grid until shown again.
 */
export default function CalendarsFilter({
  legend,
  hidden,
  onChange,
  footer,
}: {
  legend: { label: string; color: string | null; count: number }[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  /** The "31 on calendar · 3 waiting" line under the rows. */
  footer?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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

  const hiddenHere = hidden.filter((label) => legend.some((entry) => entry.label === label));
  const shown = legend.length - hiddenHere.length;
  const filtered = hiddenHere.length > 0;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={buttonClass({ variant: filtered ? "secondary" : "outline", size: "sm", className: "font-normal" })}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((previous) => !previous)}
        data-testid="calendars-filter"
      >
        <Layers className="text-muted-foreground" aria-hidden />
        <span className="text-foreground">Calendars</span>
        <span className="text-muted-foreground tabular-nums">{filtered ? `${shown} of ${legend.length}` : legend.length}</span>
        <ChevronDown className="text-muted-foreground" />
      </button>
      {open ? (
        <PopoverView>
          <div role="dialog" aria-label="Calendars" className={cn(popoverSurface, "absolute top-9 left-0 z-40 w-72 p-3 text-xs")}>
            <GroupLabel
              aside={
                filtered ? (
                  <button type="button" className="text-primary hover:underline" onClick={() => onChange([])}>
                    Show all
                  </button>
                ) : null
              }
            >
              On the calendar
            </GroupLabel>
            <ListGroup>
              {legend.map((entry) => {
                const visible = !hidden.includes(entry.label);
                return (
                  <ListRow
                    key={entry.label}
                    label={entry.label}
                    icon={<span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: swatchColor(entry.color) }} aria-hidden />}
                  >
                    <span className="tabular-nums text-muted-foreground">{entry.count}</span>
                    <ListSwitch
                      label={`Show ${entry.label}`}
                      checked={visible}
                      onChange={(next) => onChange(next ? hidden.filter((label) => label !== entry.label) : [...hidden, entry.label])}
                    />
                  </ListRow>
                );
              })}
            </ListGroup>
            {footer ? <p className="mt-2 px-1 text-muted-foreground">{footer}</p> : null}
          </div>
        </PopoverView>
      ) : null}
    </div>
  );
}
