import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { fade } from "../anim";
import { C, FONT, FPS } from "../theme";

/**
 * Empty-state loops: four-second compositions drawn with the film kit at a
 * small size, played muted and looping beside one line of copy. Each loop
 * ends on its finished state (no fade out) so `poster` can rest on it when
 * motion is reduced; the restart is a short fade in.
 */
export const LOOP = { width: 560, height: 350, fps: FPS, frames: 4 * FPS } as const;

export function LoopStage({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: LOOP.width,
        height: LOOP.height,
        background: C.bg,
        color: C.ink,
        fontFamily: FONT.sans,
        overflow: "hidden",
        opacity: fade(frame, 0, 8),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A panel of the app's surface ladder, radius 12. */
export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel, boxSizing: "border-box", ...style }}>{children}</div>;
}

/** The accent tint that fades over `frames` after `start`, as the app's ChangeTint. */
export function flash(frame: number, start: number, color: string = C.accent, frames = 30, max = 0.16) {
  if (frame < start || frame >= start + frames) return "transparent";
  const amount = max * (1 - (frame - start) / frames);
  return `color-mix(in oklab, ${color} ${Math.round(amount * 100)}%, transparent)`;
}
