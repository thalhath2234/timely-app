"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { useReducedMotion } from "@/app/_components/home/scenePlayer";
import { TOUR_CHAPTERS, TOUR_FRAMES, TOUR_STARTS, TourFilm } from "@/app/_components/film/tour";
import { FPS, HEIGHT, WIDTH } from "@/app/_components/film/theme";

/** The tour's Player, loaded only with the tour. Reports frames up and takes seeks from the rail. */
export default function TourPlayer({ onFrame, seekRef }: { onFrame: (frame: number) => void; seekRef: RefObject<((frame: number) => void) | null> }) {
  const ref = useRef<PlayerRef>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const onUpdate = (event: { detail: { frame: number } }) => onFrame(event.detail.frame);
    player.addEventListener("frameupdate", onUpdate);
    seekRef.current = (frame) => {
      // Reduced motion: rest on the chapter's last frame instead of playing it.
      const index = TOUR_STARTS.findIndex((start) => start === frame);
      if (reduced && index >= 0) {
        player.pause();
        player.seekTo(frame + TOUR_CHAPTERS[index].frames - 1);
        return;
      }
      player.seekTo(frame);
      player.play();
    };
    if (reduced) {
      player.pause();
      player.seekTo(TOUR_CHAPTERS[0].frames - 1);
    } else {
      player.play();
    }
    return () => {
      player.removeEventListener("frameupdate", onUpdate);
      seekRef.current = null;
    };
  }, [onFrame, reduced, seekRef]);

  return (
    <Player
      ref={ref}
      component={TourFilm}
      durationInFrames={TOUR_FRAMES}
      compositionWidth={WIDTH}
      compositionHeight={HEIGHT}
      fps={FPS}
      initiallyMuted
      acknowledgeRemotionLicense
      style={{ width: "100%" }}
    />
  );
}
