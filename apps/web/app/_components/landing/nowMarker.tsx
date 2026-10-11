"use client";

import { useEffect, useRef, useState } from "react";

/** Minutes since midnight for "HH:MM". */
function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function format(minutes: number) {
  const rounded = Math.round(minutes / 5) * 5;
  const hours = Math.floor(rounded / 60);
  return `${String(hours).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

/**
 * The day view's "now" line, in the landing page's hour gutter. It sits at a
 * fixed height on screen and reads the time between the hour labels it is
 * passing, so scrolling the page walks through the day.
 */
export default function NowMarker() {
  const ref = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState("09:00");

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const marker = ref.current;
      if (!marker) return;
      const y = marker.getBoundingClientRect().top;
      const hours = Array.from(document.querySelectorAll<HTMLElement>("[data-hour]")).map((element) => ({
        top: element.getBoundingClientRect().top,
        minutes: toMinutes(element.dataset.hour ?? "09:00"),
      }));
      if (!hours.length) return;
      // Hide an hour label while the marker passes over it, as the day view does.
      for (const label of document.querySelectorAll<HTMLElement>("[data-hour-label]")) {
        const box = label.getBoundingClientRect();
        const textMiddle = box.bottom - 10;
        label.style.opacity = Math.abs(textMiddle - (y + marker.offsetHeight / 2)) < 36 ? "0" : "";
      }
      let minutes = hours[0].minutes;
      for (let index = 0; index < hours.length; index++) {
        const current = hours[index];
        const next = hours[index + 1];
        if (y < current.top) break;
        if (!next || y < next.top) {
          const span = next ? next.top - current.top : 1;
          const progress = next ? (y - current.top) / span : 0;
          minutes = current.minutes + (next ? (next.minutes - current.minutes) * progress : 0);
          break;
        }
      }
      setTime(format(minutes));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className="sticky top-[45vh] z-20 flex items-center">
      <span className="lp-mono rounded-[5px] bg-[var(--lp-now)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--lp-now-ink)]">
        {time}
      </span>
      <span className="size-2 -ml-px rounded-full bg-[var(--lp-now)]" />
      <span className="h-px flex-1 bg-[var(--lp-now)]/70" />
    </div>
  );
}
