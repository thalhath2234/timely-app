import { useCurrentFrame } from "remotion";
import { pop, progress, rise, typed, typingLength } from "../anim";
import { Check, I, Pill, Pointer } from "../kit";
import { C, FONT } from "../theme";
import { LoopStage, Panel, flash } from "./stage";

const LINE = "Send the brief to Sam by Friday";
const T_TYPE = 10;
const T_TYPED = T_TYPE + typingLength(LINE, 0.9);
const T_CHIP = T_TYPED + 8;
const T_CLICK = T_CHIP + 22;
const T_TASK = T_CLICK + 6;

/** Files: a line written in a doc becomes a task linked back to the doc. */
export function FilesLoop() {
  const frame = useCurrentFrame();
  const done = frame >= T_TYPED;
  const line = done ? LINE : typed(LINE, frame, T_TYPE, 0.9);
  const task = frame >= T_TASK;
  const travel = progress(frame, T_CHIP + 4, 14);

  return (
    <LoopStage>
      <Panel style={{ position: "absolute", left: 40, top: 36, width: 300, bottom: 36, padding: "22px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
          <span>🚀</span> Launch brief
        </div>
        {[200, 150].map((w, i) => (
          <div key={i} style={{ marginTop: i ? 10 : 18, width: w, height: 10, borderRadius: 5, background: "rgba(255,255,255,0.08)" }} />
        ))}
        <div style={{ marginTop: 16, display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, lineHeight: 1.4, color: line ? C.ink : C.faint, padding: "6px 8px", marginLeft: -8, borderRadius: 8, background: flash(frame, T_TASK, C.green) }}>
          {task ? <Check size={18} /> : <span style={{ marginTop: 2, width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${done ? C.line2 : "transparent"}`, flexShrink: 0 }} />}
          <span style={{ textDecoration: task ? "line-through" : "none", color: task ? C.soft : undefined }}>
            {line || "Write anything…"}
            {!done && frame >= T_TYPE ? <span style={{ display: "inline-block", width: 2, height: 16, background: C.accent, marginLeft: 2, verticalAlign: "-3px", opacity: Math.floor(frame / 16) % 2 === 0 ? 1 : 0 }} /> : null}
          </span>
        </div>
        {frame >= T_CHIP && !task ? (
          <div style={{ marginTop: 6, marginLeft: 18, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, background: frame >= T_CLICK ? C.accentDeep : C.accent, color: frame >= T_CLICK ? "#fff" : C.accentInk, ...pop(frame, T_CHIP, 10) }}>
            <I name="sparkle" size={14} color={frame >= T_CLICK ? "#fff" : C.accentInk} /> Make it a task
          </div>
        ) : null}
        {task ? (
          <div style={{ marginTop: 6, marginLeft: 18, fontSize: 12, color: C.faint, fontFamily: FONT.mono, ...rise(frame, T_TASK, 12, 6) }}>
            → task · Fri
          </div>
        ) : null}
      </Panel>

      {frame >= T_CHIP + 2 && !task ? <Pointer x={240 - travel * 130} y={290 - travel * 72} pressed={frame >= T_CLICK} opacity={progress(frame, T_CHIP + 2, 6)} /> : null}

      {task ? (
        <Panel style={{ position: "absolute", left: 362, right: 40, top: 120, padding: "12px 14px", ...rise(frame, T_TASK + 4, 16, 24) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <I name="tasks" size={14} color={C.accent} /> Task
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 15, fontWeight: 500, lineHeight: 1.3 }}>{LINE}</p>
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill color={C.amber}>FRI</Pill>
            <Pill color={C.blue}>FROM LAUNCH BRIEF</Pill>
          </div>
        </Panel>
      ) : null}
    </LoopStage>
  );
}
