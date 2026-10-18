"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight } from "lucide-react";
import Button from "@/app/_components/_ui/button";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { TOUR_CHAPTERS, TOUR_FRAMES, TOUR_STARTS, tourChapterAt } from "@/app/_components/film/tour";
import { FPS } from "@/app/_components/film/theme";
import { cn } from "@/app/utils/cn";

const TourPlayer = dynamic(() => import("./tourPlayer"), {
  ssr: false,
  loading: () => <div className="aspect-[8/5] w-full bg-panel" />,
});

/**
 * Seen once, right after onboarding: three chapters of the product film
 * (capture, auto-schedule, dashboard cards) with their rail, then Today.
 * Reduced motion rests the film on each chapter's last frame; the rail
 * still steps through them.
 */
export default function FirstRunTour({ onDone }: { onDone: () => void }) {
  const [frame, setFrame] = useState(0);
  const seekRef = useRef<((frame: number) => void) | null>(null);
  const current = tourChapterAt(frame);
  const chapter = TOUR_CHAPTERS[current];
  const chapterProgress = Math.min(1, Math.max(0, (frame - TOUR_STARTS[current]) / chapter.frames));
  const last = current === TOUR_CHAPTERS.length - 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDone]);

  return (
    <>
      <OverlayScrim className="z-50 bg-black/60 backdrop-blur-[4px]" />
      <OverlayFrame className="z-50 items-center justify-center p-3 md:px-6">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          aria-label="A short tour of Timely"
          className="relative flex max-h-[calc(100vh-1.5rem)] w-full max-w-[960px] flex-col overflow-hidden rounded-[20px] border border-border bg-background shadow-2xl shadow-black/40"
          data-testid="first-run-tour"
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Three things to know · 15 seconds</p>
              <h2 className="mt-1 text-[22px] font-semibold leading-7 tracking-[-0.02em]" aria-live="polite">
                {chapter.headline}
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={onDone}>
              Skip
            </Button>
          </div>
          <div className="mx-6 mt-4 overflow-hidden rounded-[12px] border border-border bg-[#0b0b0f]">
            <TourPlayer onFrame={setFrame} seekRef={seekRef} />
          </div>
          <ol className="mx-6 mt-3 grid grid-cols-3 gap-2" aria-label="Chapters">
            {TOUR_CHAPTERS.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => seekRef.current?.(TOUR_STARTS[index])}
                  aria-current={index === current ? "true" : undefined}
                  className={cn(
                    "relative w-full overflow-hidden rounded-[10px] border px-3 py-2 text-left transition-colors",
                    index === current ? "border-border-strong bg-panel" : "border-border text-muted-foreground hover:bg-panel",
                  )}
                  style={{ "--c": item.color } as React.CSSProperties}
                >
                  {index === current ? (
                    <span aria-hidden className="absolute top-0 left-0 h-[2px] bg-[var(--c)] transition-[width] duration-200" style={{ width: `${Math.round(chapterProgress * 100)}%` }} />
                  ) : null}
                  <span className="block font-mono text-[11px] text-[var(--c)]">{item.n}</span>
                  <span className="block truncate text-[13px] font-medium">{item.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mx-6 mt-3 min-h-10 text-sm leading-5 text-muted-foreground">{chapter.body}</p>
          <footer className="mt-4 flex items-center gap-2 border-t border-border bg-muted/20 py-3 pl-6 pr-4">
            <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
              {Math.floor(frame / FPS)} / {Math.floor(TOUR_FRAMES / FPS)} s · the full film is on the landing page and in Help
            </p>
            <Button onClick={onDone} trailing={<ArrowRight />} data-testid="tour-open-today">
              {last ? "Open Timely" : "Open Timely now"}
            </Button>
          </footer>
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}
