"use client";

import { Sequence } from "remotion";
import { CHAPTERS, CHAPTER_STARTS } from "./chapters";
import { SCENES } from "./scenes";

/** The whole product film: every chapter's scene in order. */
export function TimelyFilm() {
  return (
    <>
      {CHAPTERS.map((chapter, i) => {
        const Scene = SCENES[chapter.id];
        return (
          <Sequence key={chapter.id} name={`${chapter.n} ${chapter.title}`} from={CHAPTER_STARTS[i]} durationInFrames={chapter.frames}>
            <Scene />
          </Sequence>
        );
      })}
    </>
  );
}
