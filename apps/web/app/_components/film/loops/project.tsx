import { useCurrentFrame } from "remotion";
import { linear, pop, progress, rise, typed, typingLength } from "../anim";
import { Caret, Pill } from "../kit";
import { C } from "../theme";
import { LoopStage, Panel } from "./stage";

const NAME = "Website launch";
const T_TYPE = 8;
const T_NAMED = T_TYPE + typingLength(NAME, 0.8);
const T_STAGES = T_NAMED + 8;
const T_TASKS = T_STAGES + 10;
const T_MOVE1 = T_TASKS + 22;
const T_MOVE2 = T_MOVE1 + 20;
const T_DEADLINE = T_MOVE2 + 18;
const STAGES = ["Backlog", "In progress", "Done"];
const TASKS = ["Write the brief", "Design homepage", "Fix Windows build"];
const LANE_W = 141;
const LANE_GAP = 10;

/** Projects: a project named, three stages appear, tasks move across them as the bar fills. */
export function ProjectLoop() {
  const frame = useCurrentFrame();
  const named = frame >= T_NAMED;
  const name = named ? NAME : typed(NAME, frame, T_TYPE, 0.8);
  // Which lane each task sits in, and how far along its move it is.
  const lane = (i: number) => (i === 0 ? (frame >= T_MOVE2 ? 2 : frame >= T_MOVE1 ? 1 : 0) : i === 1 ? (frame >= T_MOVE1 + 6 ? 1 : 0) : 0);
  const moved = (i: number) => (i === 0 ? (frame >= T_MOVE2 ? progress(frame, T_MOVE2, 16) : progress(frame, T_MOVE1, 16)) : i === 1 ? progress(frame, T_MOVE1 + 6, 16) : 0);
  const share = (frame >= T_MOVE2 ? 1 : frame >= T_MOVE1 ? 0.45 : 0.1) * 0.66;

  return (
    <LoopStage>
      <Panel style={{ position: "absolute", left: 40, right: 40, top: 40, padding: "16px 18px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: C.red, flexShrink: 0 }} />
          <span style={{ color: name ? C.ink : C.faint }}>{name || "Project name"}</span>
          <Caret on={frame >= T_TYPE && !named} height={20} />
          {frame >= T_DEADLINE ? (
            <span style={{ marginLeft: "auto", ...pop(frame, T_DEADLINE, 10) }}>
              <Pill color={C.amber}>DUE OCT 31</Pill>
            </span>
          ) : null}
        </div>

        <div style={{ marginTop: 14, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden", ...rise(frame, T_STAGES, 10, 6) }}>
          <div style={{ width: `${Math.round(share * 100)}%`, height: "100%", borderRadius: 3, background: C.green, transition: "none" }} />
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: LANE_GAP, position: "relative", height: 150 }}>
          {STAGES.map((stage, i) => (
            <div key={stage} style={{ width: LANE_W, borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel2, padding: "8px 8px 0", boxSizing: "border-box", ...rise(frame, T_STAGES + i * 3, 12, 8) }}>
              <p style={{ margin: "0 0 6px 2px", fontSize: 11, color: i === 2 ? C.green : C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>{stage}</p>
            </div>
          ))}
          {frame >= T_TASKS
            ? TASKS.map((task, i) => {
                const from = lane(i) - (moved(i) > 0 && moved(i) < 1 ? 1 : 0);
                const x = (from + (lane(i) - from) * moved(i)) * (LANE_W + LANE_GAP);
                const row = lane(i) === 0 ? TASKS.slice(0, i).filter((_, j) => lane(j) === 0).length : lane(i) === 1 ? TASKS.slice(0, i).filter((_, j) => lane(j) === 1).length : 0;
                const done = lane(i) === 2 && moved(i) >= 1;
                return (
                  <div
                    key={task}
                    style={{
                      position: "absolute",
                      left: 8,
                      top: 28 + row * 36,
                      width: LANE_W - 16,
                      translate: `${x}px 0`,
                      borderLeft: `3px solid ${done ? C.green : C.red}`,
                      borderRadius: 8,
                      background: `color-mix(in oklab, ${done ? C.green : C.red} 18%, ${C.panel})`,
                      padding: "7px 9px",
                      fontSize: 12,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      color: done ? C.soft : C.ink,
                      textDecoration: done ? "line-through" : "none",
                      boxSizing: "border-box",
                      boxShadow: moved(i) > 0 && moved(i) < 1 ? "0 16px 32px -12px rgba(0,0,0,0.8)" : "none",
                      ...pop(frame, T_TASKS + i * 4, 10),
                    }}
                  >
                    {task}
                  </div>
                );
              })
            : null}
        </div>
      </Panel>
      <p style={{ position: "absolute", left: 40, bottom: 26, margin: 0, fontSize: 14, color: C.faint, ...rise(frame, T_MOVE2 + 4, 14, 8) }}>
        {Math.round(linear(frame, T_MOVE2, T_MOVE2 + 12) * 33)}% done · 2 tasks left
      </p>
    </LoopStage>
  );
}
