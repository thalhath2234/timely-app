"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Player, type PlayerRef } from "@remotion/player";
import { useReducedMotion } from "@/app/_components/home/scenePlayer";
import type { ReplayPlan } from "./replay/plan";
import { REPLAY, ScheduleReplay, replayFrames } from "./replay/replay";

/** The auto-schedule replay with the user's own blocks as inputProps. Loaded only with the replay dialog. */
export default function ReplayPlayer({ plan }: { plan: ReplayPlan }) {
  const ref = useRef<PlayerRef>(null);
  const reduced = useReducedMotion();
  const frames = replayFrames(plan);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const onEnded = () => setEnded(true);
    player.addEventListener("ended", onEnded);
    if (reduced) {
      player.pause();
      player.seekTo(frames - 1);
    } else {
      player.play();
    }
    return () => player.removeEventListener("ended", onEnded);
  }, [frames, reduced]);

  const again = () => {
    const player = ref.current;
    if (!player) return;
    setEnded(false);
    player.seekTo(0);
    player.play();
  };

  return (
    <div className="relative">
      <Player
        ref={ref}
        component={ScheduleReplay}
        inputProps={{ plan }}
        durationInFrames={frames}
        compositionWidth={REPLAY.width}
        compositionHeight={REPLAY.height}
        fps={REPLAY.fps}
        initiallyMuted
        moveToBeginningWhenEnded={false}
        acknowledgeRemotionLicense
        style={{ width: "100%" }}
      />
      {ended && !reduced ? (
        <button
          type="button"
          onClick={again}
          className="absolute right-3 top-3 inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-white/15 bg-black/60 px-2.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/80"
        >
          <RotateCcw className="size-3.5" /> Play again
        </button>
      ) : null}
    </div>
  );
}
