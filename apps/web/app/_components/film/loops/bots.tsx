import { useCurrentFrame } from "remotion";
import { linear, pop, progress, rise } from "../anim";
import { I, Pill } from "../kit";
import { C } from "./palette";
import { LoopStage, Panel, flash } from "./stage";

/** The readings a price bot takes, oldest first; the last one is under the line. */
const READINGS = [29990, 29490, 29490, 28990, 28490, 27990, 27499, 26990, 25990, 24990];
const LINE = 25000;
const MIN = 24400;
const MAX = 30400;
const SPARK = { width: 200, height: 64 } as const;
const T_READ = 10;
const T_CROSS = 76;
const T_ALERT = T_CROSS + 12;
const T_REST = T_ALERT + 14;

const rupees = (value: number) => `₹${value.toLocaleString("en-IN")}`;
const sparkX = (index: number) => (index / (READINGS.length - 1)) * SPARK.width;
const sparkY = (value: number) => SPARK.height - ((value - MIN) / (MAX - MIN)) * SPARK.height;

/** The reading `at` (0 to readings - 1) points along the line, between two checks when it is not whole. */
function readingAt(at: number) {
  const i = Math.min(READINGS.length - 2, Math.floor(at));
  return READINGS[i] + (READINGS[i + 1] - READINGS[i]) * (at - i);
}

/** One of the three beats along the bottom: a bar that fills at an even pace while its part plays. */
function Beat({ label, frame, start, end }: { label: string; frame: number; start: number; end: number }) {
  const done = linear(frame, start, end);
  return (
    <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, fontSize: 11, fontWeight: 500, color: done > 0 ? C.soft : C.faint }}>
      <span style={{ display: "block", height: 3, borderRadius: 2, background: C.line2, overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${done * 100}%`, borderRadius: 2, background: C.accent }} />
      </span>
      {label}
    </span>
  );
}

/** Bots: a bot reads a price that drops under your line, and the alert arrives. */
export function BotsLoop() {
  const frame = useCurrentFrame();
  // Checks land at an even pace, so the line is drawn linearly rather than eased.
  const at = linear(frame, T_READ, T_CROSS) * (READINGS.length - 1);
  const crossed = frame >= T_CROSS;
  // The number is the last check's reading: it steps as each check lands while the line runs on.
  const value = READINGS[Math.floor(at)];
  const drawn = READINGS.slice(0, Math.floor(at) + 1).map((reading, i) => `${sparkX(i)},${sparkY(reading)}`);
  drawn.push(`${sparkX(at)},${sparkY(readingAt(at))}`);
  const headX = sparkX(at);
  const headY = sparkY(readingAt(at));
  const lineY = sparkY(LINE);
  const gap = value - LINE;

  return (
    <LoopStage>
      <Panel style={{ position: "absolute", left: 40, right: 40, top: 28, padding: "16px 18px 18px", overflow: "hidden" }}>
        <span style={{ position: "absolute", inset: 0, background: flash(frame, T_CROSS, C.green, 30, 0.14) }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: C.raised, border: `1px solid ${C.line}`, display: "grid", placeItems: "center", fontSize: 15, fontWeight: 600, color: C.ink, flexShrink: 0 }}>S</span>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, lineHeight: "20px" }}>Headphones under ₹25,000</span>
            <span style={{ fontSize: 12, color: C.faint, lineHeight: "16px" }}>shop page · product price · every 6 h</span>
          </span>
          <span style={{ marginLeft: "auto" }}>
            <Pill color={C.green}>WORKING</Pill>
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginTop: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 30, fontWeight: 600, lineHeight: "34px", letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", color: crossed ? C.green : C.ink }}>{rupees(value)}</span>
            <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: crossed ? C.green : C.faint }}>{gap > 0 ? `${rupees(gap)} above your line` : `${rupees(-gap)} under your line`}</span>
          </div>
          <svg width={SPARK.width} height={SPARK.height + 8} viewBox={`0 -4 ${SPARK.width} ${SPARK.height + 8}`} style={{ overflow: "visible", flexShrink: 0 }}>
            <line x1={0} x2={SPARK.width} y1={lineY} y2={lineY} stroke={C.amber} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.85} />
            <polygon points={`0,${SPARK.height} ${drawn.join(" ")} ${headX},${SPARK.height}`} fill={`color-mix(in oklab, ${C.accent} 12%, transparent)`} />
            <polyline points={drawn.join(" ")} fill="none" stroke={C.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {crossed ? <circle cx={headX} cy={headY} r={4 + 8 * progress(frame, T_CROSS, 18)} fill="none" stroke={C.green} strokeWidth={1.5} opacity={1 - progress(frame, T_CROSS, 18)} /> : null}
            <circle cx={headX} cy={headY} r={3.5} fill={crossed ? C.green : C.accent} />
          </svg>
        </div>
      </Panel>

      {frame >= T_ALERT ? (
        <div
          style={{
            position: "absolute",
            right: 40,
            top: 214,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px 10px 10px",
            borderRadius: 10,
            background: C.raised,
            border: `1px solid color-mix(in oklab, ${C.accent} 40%, ${C.line})`,
            boxShadow: "0 12px 28px -10px rgba(0,0,0,0.8)",
            ...pop(frame, T_ALERT, 10),
            ...rise(frame, T_ALERT, 12, 10),
          }}
        >
          <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: `color-mix(in oklab, ${C.accent} 18%, transparent)` }}>
            <I name="bell" size={16} color={C.accent} />
          </span>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 14, fontWeight: 600, lineHeight: "18px", fontVariantNumeric: "tabular-nums" }}>Under your line: ₹24,990</span>
            <span style={{ fontSize: 12, color: C.faint, lineHeight: "16px" }}>Bot alert · just now</span>
          </span>
        </div>
      ) : null}

      <div style={{ position: "absolute", left: 40, right: 40, bottom: 24, display: "flex", gap: 8 }}>
        <Beat label="Reading drops" frame={frame} start={T_READ} end={T_CROSS} />
        <Beat label="Line crossed" frame={frame} start={T_CROSS} end={T_ALERT} />
        <Beat label="Alert arrives" frame={frame} start={T_ALERT} end={T_REST} />
      </div>
    </LoopStage>
  );
}
