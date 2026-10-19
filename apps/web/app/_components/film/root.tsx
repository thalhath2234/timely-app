import { Composition, Folder } from "remotion";
import { CHAPTERS, FILM_FRAMES } from "./chapters";
import { TimelyFilm } from "./film";
import { SAMPLE_REPLAY } from "./replay/plan";
import { SAMPLE_REVIEW } from "./review/plan";
import { REVIEW, WeekInReview, reviewFrames } from "./review/review";
import { REPLAY, ScheduleReplay, replayFrames } from "./replay/replay";
import { TOUR_FRAMES, TourFilm } from "./tour";
import { LOOPS } from "./loops";
import { LOOP } from "./loops/stage";
import { SCENES } from "./scenes";
import { FPS, HEIGHT, WIDTH } from "./theme";

/**
 * Remotion Studio and renders start here (`make film-studio`, `make film-render`).
 * The page itself plays the same compositions through @remotion/player.
 */
export function RemotionRoot() {
  return (
    <>
      <Composition id="TimelyFilm" component={TimelyFilm} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={FILM_FRAMES} />
      <Composition id="FirstRunTour" component={TourFilm} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={TOUR_FRAMES} />
      <Composition id="ScheduleReplay" component={ScheduleReplay} width={REPLAY.width} height={REPLAY.height} fps={REPLAY.fps} durationInFrames={replayFrames(SAMPLE_REPLAY)} defaultProps={{ plan: SAMPLE_REPLAY }} />
      <Composition id="WeekInReview" component={WeekInReview} width={REVIEW.width} height={REVIEW.height} fps={REVIEW.fps} durationInFrames={reviewFrames()} defaultProps={{ plan: SAMPLE_REVIEW }} />
      <Folder name="Chapters">
        {CHAPTERS.map((chapter) => (
          <Composition key={chapter.id} id={`Chapter-${chapter.n}-${chapter.id}`} component={SCENES[chapter.id]} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={chapter.frames} />
        ))}
      </Folder>
      <Folder name="Loops">
        {Object.entries(LOOPS).map(([id, loop]) => (
          <Composition key={id} id={`Loop-${id}`} component={loop.component} width={LOOP.width} height={LOOP.height} fps={LOOP.fps} durationInFrames={LOOP.frames} />
        ))}
      </Folder>
    </>
  );
}
