import { useCurrentFrame } from "remotion";
import { motion as MOTION } from "@timely/contract/designTokens";
import { fade, pop, progress, rise } from "../anim";
import { Check, I, Mark, Pill } from "../kit";
import { C, FONT, FPS } from "../theme";
import { flash } from "../loops/stage";
import { reviewHours, type ReviewBlock, type WeekReview } from "./plan";

/**
 * The week in review: three chapters of the user's own week, 16:9 so the
 * saved video sits well in a chat or a feed. Drawn with inline styles only,
 * in DOM order and without z-index, backdrop blur or inset shadows: the
 * browser renderer (@remotion/web-renderer) paints the DOM itself and
 * supports only that subset (docs/design-system.md#week-in-review).
 */
export const REVIEW = { width: 1280, height: 720, fps: FPS } as const;

const PAD = 56;
/** Chapter bounds in frames: numbers, the grid, the list. */
const NUMBERS = { start: 0, end: 150 };
const GRID = { start: 140, end: 310 };
const LIST = { start: 300, end: 450 };
const CROSS = 10;

/** Fifteen seconds whatever the week holds, so the file is always the same length. */
export function reviewFrames() {
  return LIST.end;
}

function countUp(value: number, frame: number, start: number, duration = 24) {
  return Math.round(value * progress(frame, start, duration));
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent }}>{children}</div>;
}

export function WeekInReview({ plan }: { plan: WeekReview }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", inset: 0, width: REVIEW.width, height: REVIEW.height, background: C.bg, color: C.ink, fontFamily: FONT.sans, overflow: "hidden" }}>
      {/* A faint accent wash at the top left, the film's stage light. */}
      <div style={{ position: "absolute", left: -200, top: -260, width: 760, height: 560, borderRadius: 400, background: "linear-gradient(180deg, rgba(184,183,255,0.10), rgba(184,183,255,0))" }} />
      {frame < NUMBERS.end ? <Numbers plan={plan} frame={frame} /> : null}
      {frame >= GRID.start && frame < GRID.end ? <Grid plan={plan} frame={frame} /> : null}
      {frame >= LIST.start ? <List plan={plan} frame={frame} /> : null}
      <div style={{ position: "absolute", left: PAD, bottom: 28, display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.faint, opacity: fade(frame, 6, 12) }}>
        <Mark size={16} color={C.faint} /> Timely · {plan.label}
      </div>
    </div>
  );
}

/** Chapter 1: three film stat cards with their numbers counting up. */
function Numbers({ plan, frame }: { plan: WeekReview; frame: number }) {
  const opacity = fade(frame, NUMBERS.start, CROSS, NUMBERS.end - CROSS);
  const diff = plan.done.length - plan.doneBefore;
  const cards: { title: string; icon: "check" | "timer" | "calendar"; value: string; color: string; note: React.ReactNode }[] = [
    {
      title: "Done",
      icon: "check",
      value: String(countUp(plan.done.length, frame, 34)),
      color: C.green,
      note:
        diff === 0 ? (
          <span>same as the week before</span>
        ) : (
          <span style={{ color: diff > 0 ? C.green : C.amber }}>
            {diff > 0 ? "↗" : "↘"} {diff > 0 ? "+" : ""}
            {diff} vs the week before
          </span>
        ),
    },
    {
      title: "Focused",
      icon: "timer",
      value: reviewHours(countUp(plan.focusMinutes, frame, 42)),
      color: C.accent,
      note: `${plan.focusSessions} session${plan.focusSessions === 1 ? "" : "s"}`,
    },
    {
      title: "Planned",
      icon: "calendar",
      value: reviewHours(countUp(plan.plannedMinutes, frame, 50)),
      color: C.blue,
      note: `${plan.blocks.filter((b) => !b.event).length} block${plan.blocks.filter((b) => !b.event).length === 1 ? "" : "s"} on the calendar`,
    },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <div style={{ position: "absolute", left: PAD, top: 64, ...rise(frame, 2, 16, 14) }}>
        <Eyebrow>Your week</Eyebrow>
        <div style={{ marginTop: 10, fontFamily: FONT.display, fontSize: 64, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1 }}>{plan.label}</div>
        <div style={{ marginTop: 14, fontSize: 18, color: C.soft }}>
          {plan.done.length === 0 && plan.focusMinutes === 0 && plan.blocks.length === 0
            ? "A quiet one. Next week starts fresh."
            : `${plan.done.length} task${plan.done.length === 1 ? "" : "s"} done, ${reviewHours(plan.focusMinutes)} in focus, ${reviewHours(plan.plannedMinutes)} planned.`}
        </div>
      </div>
      <div style={{ position: "absolute", left: PAD, right: PAD, top: 262, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        {cards.map((card, i) => (
          <div
            key={card.title}
            style={{ height: 196, borderRadius: 16, border: `1px solid ${C.line}`, background: C.panel, padding: 22, boxSizing: "border-box", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden", ...pop(frame, 18 + i * MOTION.frames.stagger * 2, MOTION.frames.pop) }}
          >
            <div style={{ position: "absolute", inset: 0, background: flash(frame, 18 + i * MOTION.frames.stagger * 2, card.color, MOTION.frames.highlight, 0.14) }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, color: C.soft }}>
              <I name={card.icon} size={16} color={card.color} />
              {card.title}
            </div>
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12, fontSize: 56, fontWeight: 600, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              <span style={{ width: 4, height: 44, borderRadius: 2, background: card.color }} />
              {card.value}
            </div>
            <div style={{ fontSize: 14, color: C.faint, marginTop: 10 }}>{card.note}</div>
          </div>
        ))}
      </div>
      <ByDay plan={plan} frame={frame} />
    </div>
  );
}

/** Under the cards: one bar per day for the tasks finished that day. */
function ByDay({ plan, frame }: { plan: WeekReview; frame: number }) {
  const counts = plan.days.map((_, day) => plan.done.filter((row) => row.day === day).length);
  const max = Math.max(1, ...counts);
  const top = 500;
  const barH = 92;
  return (
    <div style={{ position: "absolute", left: PAD, right: PAD, top }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 13, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, ...rise(frame, 56, 14, 10) }}>
        Finished by day
        {plan.done.length ? <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, textTransform: "none", color: C.faint }}>· best day {plan.days[counts.indexOf(Math.max(...counts))]}</span> : null}
      </div>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 14, alignItems: "end", height: barH + 26 }}>
        {counts.map((count, day) => {
          const at = 62 + day * MOTION.frames.stagger;
          const p = progress(frame, at, 16);
          const isToday = day === plan.today;
          const future = day > plan.today;
          const h = Math.max(4, (count / max) * barH * p);
          return (
            <div key={day} style={{ display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-end", height: barH + 26 }}>
              <div style={{ textAlign: "center", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: count ? C.ink : C.faint, opacity: p, marginBottom: 6 }}>{count ? Math.round(count * p) : future ? "" : "0"}</div>
              <div style={{ height: h, borderRadius: 6, background: count ? (isToday ? C.accent : C.green) : "rgba(255,255,255,0.06)", opacity: future ? 0.35 : 1 }} />
              <div style={{ marginTop: 8, textAlign: "center", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: isToday ? C.accent : C.faint, opacity: p }}>{plan.days[day]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LABEL_W = 44;
const HEAD_H = 30;
const STAGGER = 4;

function arrivalOf(index: number) {
  return GRID.start + 16 + Math.min(index, MOTION.staggerCap) * STAGGER + Math.max(0, index - MOTION.staggerCap) * 2;
}

/** Chapter 2: the week grid, every block arriving in time order, the done ones ticked. */
function Grid({ plan, frame }: { plan: WeekReview; frame: number }) {
  const opacity = fade(frame, GRID.start, CROSS, GRID.end - CROSS);
  const hours = Math.max(1, plan.to - plan.from);
  const top = 120;
  const gridW = REVIEW.width - PAD * 2 - LABEL_W;
  const gridH = REVIEW.height - top - HEAD_H - 110;
  const colW = gridW / 7;
  const rowH = gridH / hours;
  const left = PAD + LABEL_W;
  const gridTop = top + HEAD_H;
  const x = (block: ReviewBlock) => left + block.day * colW + 3;
  const y = (block: ReviewBlock) => gridTop + (block.start - plan.from) * rowH + 1;
  const doneCount = plan.blocks.filter((b) => b.done).length;
  const lineAt = arrivalOf(plan.blocks.length) + 8;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <div style={{ position: "absolute", left: PAD, top: 52, ...rise(frame, GRID.start + 2, 16, 14) }}>
        <Eyebrow>On the calendar</Eyebrow>
        <div style={{ marginTop: 6, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {plan.blocks.length === 0 ? "Nothing was scheduled" : `${plan.blocks.length} block${plan.blocks.length === 1 ? "" : "s"} this week`}
        </div>
      </div>
      <div style={{ position: "absolute", left: PAD, right: PAD, top, bottom: 110, borderRadius: 14, border: `1px solid ${C.line}`, background: C.panel, ...rise(frame, GRID.start + 4, 12, 8) }} />
      {plan.days.map((day, i) => {
        const isToday = i === plan.today;
        const past = i <= plan.today;
        return (
          <div key={day + i} style={{ position: "absolute", left: left + i * colW, top: top + 8, width: colW, textAlign: "center", fontSize: 12, fontWeight: 600, color: isToday ? C.accent : past ? C.soft : C.faint, textTransform: "uppercase", letterSpacing: "0.06em", opacity: progress(frame, GRID.start + 6, 8) }}>
            {day}
            {isToday ? <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 3, background: C.accent, marginLeft: 5, verticalAlign: "middle" }} /> : null}
          </div>
        );
      })}
      {Array.from({ length: hours + 1 }, (_, h) => (
        <div key={h} style={{ position: "absolute", left: PAD + 1, right: PAD + 1, top: gridTop + h * rowH, borderTop: `1px solid ${C.line}`, opacity: progress(frame, GRID.start + 8, 8) }}>
          {h < hours && (hours <= 10 || h % 2 === 0) ? (
            <span style={{ position: "absolute", left: 8, top: -7, fontSize: 11, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{plan.from + h}:00</span>
          ) : null}
        </div>
      ))}
      {plan.days.map((_, i) => (
        <div key={i} style={{ position: "absolute", left: left + i * colW, top: gridTop, bottom: 110, borderLeft: `1px solid ${C.line}`, opacity: progress(frame, GRID.start + 8, 8) }} />
      ))}
      {/* Days still to come sit behind a soft wash. */}
      {plan.today < 7 ? (
        <div style={{ position: "absolute", left: left + plan.today * colW + (plan.today < 7 ? colW : 0), right: PAD + 1, top: gridTop, bottom: 110, background: "rgba(11,11,15,0.45)", opacity: progress(frame, GRID.start + 8, 8) }} />
      ) : null}
      {plan.blocks.map((block, i) => {
        const at = arrivalOf(i);
        if (frame < at) return null;
        const h = Math.max(rowH * block.hours - 2, 18);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x(block),
              top: y(block),
              width: colW - 6,
              height: h,
              borderLeft: block.event ? `3px dashed ${block.color}` : `3px solid ${block.color}`,
              borderRadius: 7,
              background: `color-mix(in oklab, ${block.color} ${block.done ? 16 : 24}%, ${C.panel})`,
              padding: "4px 7px",
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 1.2,
              color: block.done ? C.soft : C.ink,
              boxSizing: "border-box",
              overflow: "hidden",
              ...pop(frame, at, MOTION.frames.pop),
            }}
          >
            <div style={{ position: "absolute", inset: 0, background: flash(frame, at, block.color, MOTION.frames.highlight, 0.35) }} />
            <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 5 }}>
              {block.done ? <Check size={12} /> : null}
              <span style={{ textDecoration: block.done ? "line-through" : "none", textDecorationColor: C.faint }}>{block.title}</span>
            </div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: PAD, right: PAD, bottom: 62, display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: C.soft, ...rise(frame, lineAt, 12, 8) }}>
        <I name="sparkle" size={16} color={C.accent} />
        {plan.blocks.length === 0
          ? "Auto-schedule can fill next week from your tasks"
          : `${doneCount} of ${plan.blocks.length} finished${plan.blocks.some((b) => b.day > plan.today) ? `, ${plan.blocks.filter((b) => b.day > plan.today).length} still ahead` : ""}`}
        <span style={{ marginLeft: "auto" }}>
          <Pill color={C.blue}>{reviewHours(plan.plannedMinutes).toUpperCase()} PLANNED</Pill>
        </span>
      </div>
    </div>
  );
}

const MAX_ROWS = 6;

/** Chapter 3: what shipped, what was touched, and what waits. */
function List({ plan, frame }: { plan: WeekReview; frame: number }) {
  const opacity = fade(frame, LIST.start, CROSS);
  const rows = plan.done.slice(-MAX_ROWS);
  const more = plan.done.length - rows.length;
  const touched = [...plan.docs.map((title) => ({ title, icon: "files" as const })), ...plan.sheets.map((title) => ({ title, icon: "chart" as const }))].slice(0, MAX_ROWS);
  const closeAt = LIST.start + 70;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <div style={{ position: "absolute", left: PAD, top: 52, ...rise(frame, LIST.start + 2, 16, 14) }}>
        <Eyebrow>Shipped</Eyebrow>
        <div style={{ marginTop: 6, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {plan.done.length === 0 ? "Nothing ticked off yet" : `${plan.done.length} task${plan.done.length === 1 ? "" : "s"} finished`}
        </div>
      </div>
      <div style={{ position: "absolute", left: PAD, top: 136, width: 640 }}>
        {rows.map((row, i) => {
          const at = LIST.start + 14 + i * MOTION.frames.stagger * 2;
          return (
            <div key={row.title + i} style={{ display: "flex", alignItems: "center", gap: 12, height: 54, borderBottom: `1px solid ${C.line}`, fontSize: 18, ...rise(frame, at, 14, 10) }}>
              <Check size={20} />
              <span style={{ width: 8, height: 8, borderRadius: 4, background: row.color, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{row.title}</span>
              <span style={{ fontSize: 12, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>{plan.days[row.day] ?? ""}</span>
            </div>
          );
        })}
        {more > 0 ? <div style={{ marginTop: 10, fontSize: 14, color: C.faint, ...rise(frame, LIST.start + 14 + rows.length * MOTION.frames.stagger * 2, 14, 10) }}>and {more} more</div> : null}
        {plan.done.length === 0 ? <div style={{ fontSize: 16, color: C.faint, ...rise(frame, LIST.start + 14, 14, 10) }}>Star a few tasks for the day and tick them off as you go.</div> : null}
      </div>
      <div style={{ position: "absolute", left: 760, top: 136, right: PAD }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, ...rise(frame, LIST.start + 20, 14, 10) }}>Also touched</div>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {touched.length === 0 ? (
            <span style={{ fontSize: 14, color: C.faint, ...rise(frame, LIST.start + 26, 14, 10) }}>No docs or sheets this week</span>
          ) : (
            touched.map((item, i) => (
              <span key={item.title + i} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 10, border: `1px solid ${C.line2}`, background: C.panel2, fontSize: 14, maxWidth: 420, ...pop(frame, LIST.start + 26 + i * MOTION.frames.stagger * 2, MOTION.frames.pop) }}>
                <I name={item.icon} size={14} color={item.icon === "files" ? C.violet : C.cyan} />
                <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{item.title}</span>
              </span>
            ))
          )}
        </div>
      </div>
      <div style={{ position: "absolute", left: PAD, right: PAD, bottom: 62, display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: C.soft, ...rise(frame, closeAt, 12, 8) }}>
        <I name="arrow" size={16} color={C.accent} />
        {plan.open === 0 ? "Nothing waiting. Enjoy the weekend." : `${plan.open} task${plan.open === 1 ? "" : "s"} waiting for next week`}
      </div>
    </div>
  );
}
