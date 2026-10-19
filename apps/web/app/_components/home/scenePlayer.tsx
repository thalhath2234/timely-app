"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { SCENES } from "@/app/_components/film/scenes";
import { FPS, HEIGHT, WIDTH } from "@/app/_components/film/theme";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribe(listener: () => void) {
  const media = window.matchMedia(REDUCED);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** False on the server and during hydration, so the first frame hydrates cleanly. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED).matches, () => false);
}

/**
 * One chapter's scene, looping while it is on screen. With reduced motion it
 * rests on its last frame. The Player keeps the film's 16:10 ratio, so the
 * frame around it never reflows.
 */
export function ScenePlayer({ id, frames, label }: { id: string; frames: number; label: string }) {
  const Scene = SCENES[id];
  const ref = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = box.current;
    const player = ref.current;
    if (!node || !player) return;
    if (reduced) {
      player.pause();
      player.seekTo(frames - 1);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible) player.play();
        else player.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [frames, reduced]);

  return (
    <div ref={box} role="img" aria-label={label}>
      <Player
        ref={ref}
        component={Scene}
        durationInFrames={frames}
        compositionWidth={WIDTH}
        compositionHeight={HEIGHT}
        fps={FPS}
        loop
        initiallyMuted
        acknowledgeRemotionLicense
        style={{ width: "100%" }}
      />
    </div>
  );
}
