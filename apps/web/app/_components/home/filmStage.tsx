"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Player, type PlayerRef } from "@remotion/player";
import { Pause, Play } from "lucide-react";
import { CHAPTERS, CHAPTER_STARTS, FILM_FRAMES, chapterAt } from "@/app/_components/film/chapters";
import { TimelyFilm } from "@/app/_components/film/film";
import { FPS, HEIGHT, WIDTH } from "@/app/_components/film/theme";
import { cn } from "@/app/utils/cn";
import { useReducedMotion } from "./scenePlayer";

/**
 * The hero: the whole product film on one stage, with the chapter rail under
 * it. The rail follows the film; a rail item seeks to its chapter, and each
 * item is also a link to that chapter's section further down the page.
 */
export default function FilmStage() {
  const ref = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const current = chapterAt(frame);
  const chapter = CHAPTERS[current];

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) => setFrame(event.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, []);

  // Play while the stage is on screen; pause when it scrolls away. Reduced motion: rest on the last chapter's end.
  useEffect(() => {
    const node = box.current;
    const player = ref.current;
    if (!node || !player) return;
    if (reduced) {
      player.pause();
      player.seekTo(FILM_FRAMES - 1);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) player.play();
        else player.pause();
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  const seek = (index: number) => {
    const player = ref.current;
    if (!player) return;
    player.seekTo(CHAPTER_STARTS[index]);
    if (!reduced) player.play();
  };

  const toggle = () => {
    const player = ref.current;
    if (!player) return;
    if (player.isPlaying()) player.pause();
    else player.play();
  };

  const chapterProgress = (frame - CHAPTER_STARTS[current]) / chapter.frames;
  const seconds = Math.floor(frame / FPS);

  return (
    <div ref={box}>
      <div className="s-stage group">
        <Player
          ref={ref}
          component={TimelyFilm}
          durationInFrames={FILM_FRAMES}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          fps={FPS}
          loop
          initiallyMuted
          acknowledgeRemotionLicense
          style={{ width: "100%" }}
        />
        {/* Stage controls: play/pause and the running time. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-3 sm:p-4">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause the film" : "Play the film"}
            className="pointer-events-auto flex size-10 items-center justify-center rounded-[10px] border border-white/15 bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
          </button>
          <span className="s-mono rounded-[8px] bg-black/60 px-2 py-1 text-xs text-white/80 backdrop-blur">
            {String(Math.floor(seconds / 60)).padStart(1, "0")}:{String(seconds % 60).padStart(2, "0")} / 0:{String(Math.floor(FILM_FRAMES / FPS)).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Chapter rail: desktop as a row of eleven, phone as a scrolling strip. */}
      <nav aria-label="Chapters" className="-mx-4 mt-3 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ol className="grid min-w-[840px] grid-cols-11 gap-2 sm:min-w-0 lg:gap-3">
          {CHAPTERS.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => seek(index)}
                aria-current={index === current ? "true" : undefined}
                className="s-rail-item w-full"
                style={{ "--c": item.color } as React.CSSProperties}
              >
                {index === current && !reduced ? (
                  <span aria-hidden className="absolute top-[-2px] left-0 h-[2px] bg-[var(--c)] transition-[width] duration-200" style={{ width: `${Math.round(Math.min(1, Math.max(0, chapterProgress)) * 100)}%` }} />
                ) : null}
                <span>{item.n}</span>
                <span>{item.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {/* What is playing now, with a way into its section. */}
      <div className={cn("mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1")}>
        <p className="s-display text-xl sm:text-2xl" aria-live="polite">
          {chapter.headline}
        </p>
        <Link href={`#${chapter.id}`} className="text-sm font-medium text-[var(--s-primary)] underline-offset-4 hover:underline">
          Read about {chapter.title.toLowerCase()}
        </Link>
      </div>
    </div>
  );
}
