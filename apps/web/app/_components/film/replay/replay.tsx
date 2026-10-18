import { useCurrentFrame } from "remotion";
import { motion as MOTION } from "@timely/contract/designTokens";
import { pop, progress, rise } from "../anim";
import { I, Pill } from "../kit";
import { C, FONT, FPS } from "../theme";
import { flash } from "../loops/stage";
import type { ReplayBlock, ReplayPlan } from "./plan";

/** The auto-schedule replay: the user's own blocks arriving on their week, 8:5 like the loops. */
export const REPLAY = { width: 960, height: 600, fps: FPS } as const;

const PAD = 40;
const LABEL_W = 44;
const HEAD_H = 28;
const T_GRID = 0;
const T_FIRST = 14;
const STAGGER = 6;
const MOVE_FRAMES = 16;

/** How long the replay runs for this plan: every arrival, the moves, and a second on the result. */
export function replayFrames(plan: ReplayPlan) {
  const arrivals = T_FIRST + Math.min(plan.placed.length, MOTION.staggerCap) * STAGGER + Math.max(0, plan.placed.length - MOTION.staggerCap) * 2;
  return arrivals + (plan.moved.length ? MOVE_FRAMES + 10 : 0) + 40;
}

function arrivalOf(index: number) {
  return T_FIRST + Math.min(index, MOTION.staggerCap) * STAGGER + Math.max(0, index - MOTION.staggerCap) * 2;
}

export function ScheduleReplay({ plan }: { plan: ReplayPlan }) {
  const frame = useCurrentFrame();
  const cols = plan.days.length;
  const hours = Math.max(1, plan.to - plan.from);
  const gridW = REPLAY.width - PAD * 2 - LABEL_W;
  const gridH = REPLAY.height - PAD * 2 - HEAD_H - 36;
  const colW = gridW / cols;
  const rowH = gridH / hours;
  const left = PAD + LABEL_W;
  const top = PAD + HEAD_H;
  const movesAt = arrivalOf(plan.placed.length) + 4;
  const doneAt = movesAt + (plan.moved.length ? MOVE_FRAMES + 6 : 0);
  const x = (block: ReplayBlock) => left + block.day * colW + 3;
  const y = (block: ReplayBlock) => top + (block.start - plan.from) * rowH + 1;

  const box = (block: ReplayBlock, key: string, at: number, extra: React.CSSProperties = {}) => (
    <div
      key={key}
      style={{
        position: "absolute",
        left: x(block),
        top: y(block),
        width: colW - 6,
        height: Math.max(rowH * block.hours - 2, 18),
        borderLeft: `3px solid ${block.color}`,
        borderRadius: 7,
        background: `color-mix(in oklab, ${block.color} 22%, ${C.panel})`,
        padding: "4px 7px",
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1.2,
        color: C.ink,
        boxSizing: "border-box",
        overflow: "hidden",
        ...pop(frame, at, MOTION.frames.pop),
        ...extra,
      }}
    >
      {block.title}
      <span style={{ position: "absolute", inset: 0, background: flash(frame, at, block.color, MOTION.frames.highlight, 0.35), pointerEvents: "none" }} />
    </div>
  );

  return (
    <div style={{ position: "absolute", inset: 0, width: REPLAY.width, height: REPLAY.height, background: C.bg, color: C.ink, fontFamily: FONT.sans, overflow: "hidden" }}>
      {/* Day heads and hour lines. */}
      <div style={{ position: "absolute", left: PAD, right: PAD, top: PAD, bottom: PAD + 36, borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel, ...rise(frame, T_GRID, 10, 6) }} />
      {plan.days.map((day, i) => (
        <span key={day + i} style={{ position: "absolute", left: left + i * colW, top: PAD + 7, width: colW, textAlign: "center", fontSize: 12, fontWeight: 600, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em", opacity: progress(frame, T_GRID + 2, 8) }}>
          {day}
        </span>
      ))}
      {Array.from({ length: hours + 1 }, (_, h) => (
        <div key={h} style={{ position: "absolute", left: PAD + 1, right: PAD + 1, top: top + h * rowH, borderTop: `1px solid ${C.line}`, opacity: progress(frame, T_GRID + 4, 8) }}>
          {h < hours && (hours <= 10 || h % 2 === 0) ? (
            <span style={{ position: "absolute", left: 8, top: -7, fontSize: 11, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{plan.from + h}:00</span>
          ) : null}
        </div>
      ))}
      {plan.days.map((_, i) => (
        <div key={i} style={{ position: "absolute", left: left + i * colW, top: top, bottom: PAD + 36, borderLeft: `1px solid ${C.line}`, opacity: progress(frame, T_GRID + 4, 8) }} />
      ))}

      {/* Blocks arrive in time order; moved ones slide once the arrivals are in. */}
      {plan.placed.map((block, i) => (frame >= arrivalOf(i) ? box(block, `p${i}`, arrivalOf(i)) : null))}
      {plan.moved.map((move, i) => {
        const p = progress(frame, movesAt, MOVE_FRAMES);
        const dx = (x(move.to) - x(move.from)) * p;
        const dy = (y(move.to) - y(move.from)) * p;
        return box(move.from, `m${i}`, T_GRID + 6, { translate: `${dx}px ${dy}px`, boxShadow: p > 0 && p < 1 ? "0 16px 32px -12px rgba(0,0,0,0.8)" : "none", zIndex: 2 });
      })}
      {/* Where a moved block came from, outlined while it travels. */}
      {plan.moved.map((move, i) =>
        frame >= movesAt ? (
          <div key={`g${i}`} style={{ position: "absolute", left: x(move.from), top: y(move.from), width: colW - 6, height: Math.max(rowH * move.from.hours - 2, 18), borderRadius: 7, border: `1.5px dashed ${C.line2}`, boxSizing: "border-box", opacity: 1 - progress(frame, movesAt + MOVE_FRAMES, 20) }} />
        ) : null,
      )}

      <div style={{ position: "absolute", left: PAD, right: PAD, bottom: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: C.soft, ...rise(frame, doneAt, 12, 8) }}>
        <I name="sparkle" size={16} color={C.accent} />
        {plan.placed.length + plan.moved.length} block{plan.placed.length + plan.moved.length === 1 ? "" : "s"} placed inside your working hours
        {plan.moved.length ? ` · ${plan.moved.length} moved out of a meeting's way` : ""}
        <span style={{ marginLeft: "auto" }}>
          <Pill color={C.green}>{Math.round(plan.minutes / 60)}H {plan.minutes % 60 ? `${plan.minutes % 60}M` : ""} PLANNED</Pill>
        </span>
      </div>
    </div>
  );
}
