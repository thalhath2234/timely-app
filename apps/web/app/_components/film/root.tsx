import { Composition, Folder } from "remotion";
import { CHAPTERS, FILM_FRAMES } from "./chapters";
import { TimelyFilm } from "./film";
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
      <Folder name="Chapters">
        {CHAPTERS.map((chapter) => (
          <Composition key={chapter.id} id={`Chapter-${chapter.n}-${chapter.id}`} component={SCENES[chapter.id]} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={chapter.frames} />
        ))}
      </Folder>
    </>
  );
}
