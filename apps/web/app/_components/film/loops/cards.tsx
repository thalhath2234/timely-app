import { useCurrentFrame } from "remotion";
import { linear, pop, progress, rise } from "../anim";
import { I, Pointer } from "../kit";
import { C, FONT } from "../theme";
import { LoopStage, Panel } from "./stage";

const T_POINT = 6;
const T_GRAB = 26;
const T_DROP = 54;
const T_COUNT = T_DROP + 6;
const T_SECOND = 92;

const PICKS: Array<[string, "timer" | "chart" | "hash"]> = [
  ["Focus today", "timer"],
  ["Streak", "chart"],
  ["Open tasks", "hash"],
];

function slotX(i: number) {
  return 40 + (i % 2) * 176;
}
function slotY(i: number) {
  return 40 + Math.floor(i / 2) * 136;
}

/** Dashboard: a card picked from the list, dragged onto the grid, its number counting up. */
export function CardsLoop() {
  const frame = useCurrentFrame();
  const grabbed = frame >= T_GRAB;
  const dropped = frame >= T_DROP;
  const travel = progress(frame, T_GRAB, T_DROP - T_GRAB);
  const toPick = progress(frame, T_POINT, 16);
  const pickX = 392;
  const pickY = 70;
  const pointerX = grabbed ? pickX - travel * (pickX - 110) : 230 + toPick * (pickX - 230);
  const pointerY = grabbed ? pickY + travel * (slotY(0) + 60 - pickY) : 250 - toPick * (250 - pickY);
  const minutes = Math.round(linear(frame, T_COUNT, T_COUNT + 26) * 160);
  const cardX = dropped ? slotX(0) : grabbed ? 372 - travel * (372 - slotX(0)) : 372;
  const cardY = dropped ? slotY(0) : grabbed ? 48 + travel * (slotY(0) - 48) : 48;

  return (
    <LoopStage>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ position: "absolute", left: slotX(i), top: slotY(i), width: 160, height: 120, borderRadius: 12, border: `1.5px dashed ${i === 0 && grabbed && !dropped ? C.accent : C.line2}`, background: i === 0 && grabbed && !dropped ? `color-mix(in oklab, ${C.accent} 8%, transparent)` : "transparent" }} />
      ))}

      <div style={{ position: "absolute", left: 372, top: 36, width: 148, ...rise(frame, 0, 12) }}>
        <p style={{ margin: "0 0 6px 4px", fontSize: 12, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Add card</p>
        {PICKS.map(([name, icon], i) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 10px", borderRadius: 10, fontSize: 14, color: C.soft, opacity: i === 0 && grabbed ? 0.35 : 1, marginTop: i ? 4 : 0, border: `1px solid ${C.line}`, background: C.panel }}>
            <I name={icon} size={15} color={C.faint} />
            {name}
          </div>
        ))}
      </div>

      <Panel
        style={{
          position: "absolute",
          left: cardX,
          top: cardY,
          width: 160,
          height: 120,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          opacity: grabbed ? 1 : 0,
          scale: grabbed && !dropped ? "1.05" : "1",
          boxShadow: grabbed && !dropped ? "0 24px 48px -16px rgba(0,0,0,0.8)" : "none",
          border: `1px solid ${dropped ? C.line : C.line2}`,
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
          <I name="grip" size={13} color={C.faint} />
          <I name="timer" size={14} color={C.soft} /> Focus today
        </div>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: FONT.sans }}>
          <span style={{ width: 3, height: 28, borderRadius: 2, background: C.accent }} />
          {dropped ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` : "—"}
        </div>
      </Panel>

      {frame >= T_SECOND ? (
        <Panel style={{ position: "absolute", left: slotX(1), top: slotY(1), width: 160, height: 120, padding: 12, display: "flex", flexDirection: "column", ...pop(frame, T_SECOND, 10) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
            <I name="grip" size={13} color={C.faint} />
            <I name="chart" size={14} color={C.soft} /> Streak
          </div>
          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>
            <span style={{ width: 3, height: 28, borderRadius: 2, background: C.green }} />
            {Math.round(linear(frame, T_SECOND + 4, T_SECOND + 20) * 12)} days
          </div>
        </Panel>
      ) : null}

      {!dropped ? <Pointer x={pointerX} y={pointerY} pressed={grabbed} opacity={progress(frame, T_POINT, 6)} /> : null}
    </LoopStage>
  );
}
