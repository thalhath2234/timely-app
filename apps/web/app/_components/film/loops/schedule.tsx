import { useCurrentFrame } from "remotion";
import { linear, pop, progress, rise } from "../anim";
import { I, Pill } from "../kit";
import { C } from "../theme";
import { LoopStage, Panel, flash } from "./stage";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const HOURS = 8; // 9:00 to 17:00
const ROW = 24;
const COL = 86;
const LEFT = 40 + 44;
const TOP = 86;
const T_LIST = 6;
const T_PLACE = 34;
const T_MEETING = 74;
const T_MOVE = T_MEETING + 10;
const T_LINE = 106;

type Block = { title: string; day: number; start: number; hours: number; color: string; at: number };
/** Tasks with estimates, in deadline order, each finding the first free slot. */
const TASKS: Block[] = [
  { title: "Write release notes", day: 0, start: 1, hours: 1, color: C.green, at: T_PLACE },
  { title: "Design the homepage", day: 1, start: 0, hours: 3, color: C.amber, at: T_PLACE + 6 },
  { title: "Fix build on Windows", day: 2, start: 0, hours: 2, color: C.green, at: T_PLACE + 12 },
  { title: "Record the demo", day: 3, start: 1, hours: 1, color: C.blue, at: T_PLACE + 18 },
];
const FIXED: Block[] = [
  { title: "Standup", day: 0, start: 0, hours: 0.5, color: C.faint, at: -1 },
  { title: "Lunch with Sam", day: 2, start: 3.5, hours: 1, color: C.faint, at: -1 },
];

function BlockBox({ block, frame, x = 0, y = 0, moving = false }: { block: Block; frame: number; x?: number; y?: number; moving?: boolean }) {
  const placed = block.at < 0 ? { opacity: 1 } : pop(frame, block.at, 8);
  return (
    <div
      style={{
        position: "absolute",
        left: LEFT + block.day * COL + 3 + x,
        top: TOP + block.start * ROW + 1 + y,
        width: COL - 6,
        height: block.hours * ROW - 2,
        borderLeft: `3px solid ${block.color}`,
        borderRadius: 6,
        background: block.at < 0 ? C.raised : `color-mix(in oklab, ${block.color} 22%, ${C.panel})`,
        padding: "3px 6px",
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.2,
        color: block.at < 0 ? C.soft : C.ink,
        boxSizing: "border-box",
        overflow: "hidden",
        boxShadow: moving ? "0 12px 24px -8px rgba(0,0,0,0.8)" : "none",
        zIndex: moving ? 3 : 1,
        ...placed,
      }}
    >
      {block.title}
      {block.at >= 0 && frame < block.at + 30 ? <span style={{ position: "absolute", inset: 0, background: flash(frame, block.at, block.color, 30, 0.35) }} /> : null}
    </div>
  );
}

/** Calendar: estimated tasks drop into free time in deadline order; a meeting lands and one block moves. */
export function ScheduleLoop() {
  const frame = useCurrentFrame();
  const meeting = frame >= T_MEETING;
  const moveP = progress(frame, T_MOVE, 16);
  const pending = TASKS.filter((task) => frame < task.at);

  return (
    <LoopStage>
      <div style={{ position: "absolute", left: 40, top: 30, right: 40, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: C.faint, ...rise(frame, T_LIST, 10, 6) }}>
        <I name="sparkle" size={14} color={C.amber} />
        {pending.length > 0 ? (
          <span>
            Auto-schedule · {pending.length} to place · <span style={{ color: C.soft }}>{pending[0].title}, {pending[0].hours}h</span>
          </span>
        ) : meeting ? (
          <span style={{ color: C.soft }}>Client review landed on Thu · Record the demo moved to Fri</span>
        ) : (
          <span>Auto-schedule · everything placed inside working hours</span>
        )}
        {frame >= T_LINE ? (
          <span style={{ marginLeft: "auto", ...pop(frame, T_LINE, 8) }}>
            <Pill color={C.green}>4 PLACED · 7H</Pill>
          </span>
        ) : null}
      </div>

      <Panel style={{ position: "absolute", left: 40, right: 40, top: 58, bottom: 30, overflow: "hidden" }}>
        {DAYS.map((day, i) => (
          <span key={day} style={{ position: "absolute", left: LEFT - 40 + i * COL, top: 8, width: COL, textAlign: "center", fontSize: 11, fontWeight: 600, color: i === 3 && meeting ? C.ink : C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {day}
          </span>
        ))}
        {Array.from({ length: HOURS + 1 }, (_, h) => (
          <div key={h} style={{ position: "absolute", left: 0, right: 0, top: TOP - 58 + h * ROW, borderTop: `1px solid ${C.line}` }}>
            {h % 2 === 0 ? <span style={{ position: "absolute", left: 10, top: -7, fontSize: 10, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{9 + h}:00</span> : null}
          </div>
        ))}
        {DAYS.map((_, i) => (
          <div key={i} style={{ position: "absolute", top: 28, bottom: 0, left: LEFT - 40 + i * COL, borderLeft: `1px solid ${C.line}` }} />
        ))}
        <div style={{ position: "absolute", inset: 0, translate: "-40px -58px" }}>
          {FIXED.map((block) => (
            <BlockBox key={block.title} block={block} frame={frame} />
          ))}
          {TASKS.filter((task) => frame >= task.at).map((task) => {
            if (task.title === "Record the demo" && frame >= T_MOVE) {
              // The meeting took its slot: it slides to Friday, same time.
              return <BlockBox key={task.title} block={task} frame={frame} x={moveP * COL} moving={moveP < 1} />;
            }
            return <BlockBox key={task.title} block={task} frame={frame} />;
          })}
          {meeting ? <BlockBox block={{ title: "Client review", day: 3, start: 0.5, hours: 1.5, color: C.pink, at: T_MEETING }} frame={frame} /> : null}
          {/* The slot each task is about to take, outlined a few frames ahead. */}
          {TASKS.filter((task) => frame >= task.at - 8 && frame < task.at).map((task) => (
            <div key={task.title} style={{ position: "absolute", left: LEFT + task.day * COL + 3, top: TOP + task.start * ROW + 1, width: COL - 6, height: task.hours * ROW - 2, borderRadius: 6, border: `1.5px dashed ${task.color}`, boxSizing: "border-box", opacity: linear(frame, task.at - 8, task.at - 2) }} />
          ))}
        </div>
      </Panel>
    </LoopStage>
  );
}
