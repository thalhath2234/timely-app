"use client";

import { Sequence } from "remotion";
import { CHAPTERS, type Chapter } from "./chapters";
import { SCENES } from "./scenes";

/** The three chapters a new account sees once: capture, auto-schedule, dashboard cards. */
export const TOUR_IDS = ["capture", "auto-schedule", "cards"] as const;
export const TOUR_CHAPTERS: Chapter[] = TOUR_IDS.map((id) => CHAPTERS.find((chapter) => chapter.id === id)!);
export const TOUR_STARTS = TOUR_CHAPTERS.reduce<number[]>((starts, chapter, i) => {
  starts.push(i === 0 ? 0 : starts[i - 1] + TOUR_CHAPTERS[i - 1].frames);
  return starts;
}, []);
export const TOUR_FRAMES = TOUR_CHAPTERS.reduce((sum, chapter) => sum + chapter.frames, 0);

export function tourChapterAt(frame: number) {
  let index = 0;
  for (let i = 0; i < TOUR_STARTS.length; i++) if (frame >= TOUR_STARTS[i]) index = i;
  return index;
}

/** The first-run tour: the three chapters' scenes in order, 15 seconds. */
export function TourFilm() {
  return (
    <>
      {TOUR_CHAPTERS.map((chapter, i) => {
        const Scene = SCENES[chapter.id];
        return (
          <Sequence key={chapter.id} name={`${chapter.n} ${chapter.title}`} from={TOUR_STARTS[i]} durationInFrames={chapter.frames}>
            <Scene />
          </Sequence>
        );
      })}
    </>
  );
}
