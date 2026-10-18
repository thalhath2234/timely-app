import { useCurrentFrame } from "remotion";
import { pop, progress, rise, typed, typingLength } from "../anim";
import { Btn, Caret, Check, I, Pill, Pointer } from "../kit";
import { C } from "../theme";
import { LoopStage, Panel, flash } from "./stage";

const TEXT = "Book a moving van before Friday";
const T_TYPE = 8;
const T_TYPED = T_TYPE + typingLength(TEXT, 0.9);
const T_ROW = T_TYPED + 8;
const T_CLICK = T_ROW + 26;
const T_TASK = T_CLICK + 6;

/** Inbox: a thought typed into the capture box lands as a row, then becomes a task. */
export function CaptureLoop() {
  const frame = useCurrentFrame();
  const landed = frame >= T_ROW;
  const task = frame >= T_TASK;
  const typing = landed ? "" : typed(TEXT, frame, T_TYPE, 0.9);
  const focused = frame >= T_TYPE && !landed;
  const travel = progress(frame, T_ROW + 6, 16);
  const pointerX = 120 + travel * 300;
  const pointerY = 120 + travel * 72;

  return (
    <LoopStage>
      <div style={{ position: "absolute", left: 40, right: 40, top: 48, display: "flex", gap: 10 }}>
        <div
          style={{
            flex: 1,
            height: 48,
            borderRadius: 12,
            border: `1px solid ${focused ? C.accent : C.line2}`,
            background: "#0b0c11",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            fontSize: 17,
            color: typing ? C.ink : C.faint,
            boxShadow: focused ? `0 0 0 4px color-mix(in oklab, ${C.accent} 22%, transparent)` : "none",
          }}
        >
          {typing || "Something to follow up…"}
          <Caret on={focused} height={20} />
        </div>
        <Btn primary style={{ height: 48, fontSize: 15, padding: "0 16px" }}>
          Capture
        </Btn>
      </div>

      {landed ? (
        <Panel style={{ position: "absolute", left: 40, right: 40, top: 124, overflow: "hidden", ...pop(frame, T_ROW, 10) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, height: 60, padding: "0 18px", fontSize: 17, background: flash(frame, task ? T_TASK : T_ROW, task ? C.green : C.accent) }}>
            {task ? <Check size={22} /> : <span style={{ width: 22, height: 22, borderRadius: 7, border: `1.5px solid ${C.line2}` }} />}
            <span style={{ flex: 1, fontWeight: 500 }}>{TEXT}</span>
            {task ? (
              <span style={{ display: "flex", gap: 8, ...rise(frame, T_TASK, 12, 8) }}>
                <Pill color={C.violet}>PERSONAL</Pill>
                <Pill color={C.amber}>FRI</Pill>
              </span>
            ) : (
              <>
                <Pill color={C.green}>NEW</Pill>
                <Btn primary style={{ height: 34, fontSize: 13, background: frame >= T_CLICK ? C.accentDeep : C.accent, color: frame >= T_CLICK ? "#fff" : C.accentInk }}>
                  Make it a task
                </Btn>
              </>
            )}
          </div>
        </Panel>
      ) : null}

      {landed && !task ? <Pointer x={pointerX} y={pointerY} pressed={frame >= T_CLICK} opacity={progress(frame, T_ROW + 2, 6)} /> : null}

      <div style={{ position: "absolute", left: 40, right: 40, bottom: 44, display: "flex", alignItems: "center", gap: 12, fontSize: 15, color: C.faint, ...rise(frame, task ? T_TASK + 8 : 200, 14, 8) }}>
        <I name="calendar" size={18} color={C.amber} />
        Scheduled for Friday, 10:00. Nothing else to fill in.
      </div>
    </LoopStage>
  );
}
