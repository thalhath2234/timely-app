import { Easing, interpolate } from "remotion";
import { motion as MOTION } from "@timely/contract/designTokens";

/** Fast out, long settle: the one easing the film shares with the app (designTokens.motion). */
export const EASE = Easing.bezier(...MOTION.ease);

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE } as const;

/** 0 → 1 between `start` and `start + duration` frames. */
export function progress(frame: number, start: number, duration = 14) {
  return interpolate(frame, [start, start + duration], [0, 1], CLAMP);
}

/** Opacity that fades in at `start` and, when `end` is given, out again at `end`. */
export function fade(frame: number, start: number, duration = 12, end?: number) {
  const inP = progress(frame, start, duration);
  if (end === undefined) return inP;
  return Math.min(inP, 1 - progress(frame, end, duration));
}

/** Style for an element that rises into place: fades in while moving up `distance` px. */
export function rise(frame: number, start: number, duration: number = MOTION.frames.reveal, distance: number = MOTION.revealDistance) {
  const p = progress(frame, start, duration);
  return { opacity: p, translate: `0px ${(1 - p) * distance}px` };
}

/** Style for an element that pops in from slightly smaller. */
export function pop(frame: number, start: number, duration: number = MOTION.frames.pop) {
  const p = progress(frame, start, duration);
  return { opacity: p, scale: `${0.94 + 0.06 * p}` };
}

/** The first `n` characters of `text`, typed from `start` at `cps` characters per frame. */
export function typed(text: string, frame: number, start: number, cps = 0.7) {
  const count = Math.max(0, Math.floor((frame - start) * cps));
  return text.slice(0, Math.min(text.length, count));
}

/** Frames it takes `typed()` to finish `text`. */
export function typingLength(text: string, cps = 0.7) {
  return Math.ceil(text.length / cps);
}

/** True on and off every `period` frames, for a caret or a pulse. */
export function blink(frame: number, period = 16) {
  return Math.floor(frame / period) % 2 === 0;
}

/** Linear 0 → 1 between two frames, clamped, no easing. */
export function linear(frame: number, start: number, end: number) {
  return interpolate(frame, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}
