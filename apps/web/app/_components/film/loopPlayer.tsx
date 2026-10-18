"use client";

import { useEffect, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { useReducedMotion } from "@/app/_components/home/scenePlayer";
import { LOOPS, type LoopId } from "./loops";
import { LOOP } from "./loops/stage";

/**
 * One empty-state loop, playing muted while on screen. With reduced motion it
 * rests on the loop's finished frame as a poster. Imported lazily by
 * EmptyState, so a page without an empty state loads no Remotion code.
 */
export default function LoopPlayer({ id }: { id: LoopId }) {
  const loop = LOOPS[id];
  const ref = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = box.current;
    const player = ref.current;
    if (!node || !player) return;
    if (reduced) {
      player.pause();
      player.seekTo(loop.poster);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) player.play();
        else player.pause();
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loop.poster, reduced]);

  return (
    <div ref={box} role="img" aria-label={loop.label} className="aspect-[8/5] w-full">
      <Player
        ref={ref}
        component={loop.component}
        durationInFrames={LOOP.frames}
        compositionWidth={LOOP.width}
        compositionHeight={LOOP.height}
        fps={LOOP.fps}
        loop
        initiallyMuted
        acknowledgeRemotionLicense
        style={{ width: "100%" }}
      />
    </div>
  );
}
