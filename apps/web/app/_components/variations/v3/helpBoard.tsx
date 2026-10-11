"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The help board's lanes: on desktop a horizontal scroller with snap points
 * and previous/next buttons that move one lane at a time; on phones the lanes
 * stack and the buttons are hidden with them.
 */
export default function HelpBoard({ toolbar, children }: { toolbar: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ back: false, forward: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setCanScroll({
        back: el.scrollLeft > 4,
        forward: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  const step = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const lane = el.querySelector<HTMLElement>(".v3-lane");
    const width = lane ? lane.offsetWidth + 16 : 288;
    el.scrollBy({ left: direction * width, behavior: "smooth" });
  };

  const scrollable = canScroll.back || canScroll.forward;

  return (
    <div>
      <div className="v-container flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <div className="hidden gap-1.5 lg:flex" aria-hidden={!scrollable}>
          <button type="button" className="v3-iconbtn" onClick={() => step(-1)} disabled={!canScroll.back} aria-label="Previous section">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" className="v3-iconbtn" onClick={() => step(1)} disabled={!canScroll.forward} aria-label="Next section">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="v-container mt-4 lg:!max-w-none lg:!px-0">
        <div ref={ref} className="v3-lanes">
          {children}
        </div>
      </div>
    </div>
  );
}
