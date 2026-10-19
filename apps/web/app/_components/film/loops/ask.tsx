import { useCurrentFrame } from "remotion";
import { pop, progress, rise, typed, typingLength } from "../anim";
import { Btn, Caret, Check, I, Pointer } from "../kit";
import { C } from "../theme";
import { LoopStage, Panel, flash } from "./stage";

const ASK = "plan my launch week, keep Friday free";
const T_TYPE = 8;
const T_SENT = T_TYPE + typingLength(ASK, 1.1) + 4;
const T_CARD = T_SENT + 12;
const T_ACCEPT = T_CARD + 34;
const STARTERS: Array<["projects" | "chart" | "calendar" | "files", string, string]> = [
  ["projects", "Start a project", "A PDF tool, with a plan doc"],
  ["chart", "Build a budget", "Item, quantity, unit price, total"],
  ["calendar", "Make room to learn", "Three study sessions a week"],
  ["files", "Save a receipt", "Into the expense sheet"],
];
const CHANGES: Array<[string, string, string]> = [
  ["+", "Fix build on Windows", "Mon · 2h"],
  ["+", "Write release notes", "Tue · 1h"],
  ["↷", "Design the homepage", "Wed → Thu"],
  ["+", "Record the demo", "Thu · 45 min"],
];

/** Assistant: a question typed, a proposal of four changes, Accept all ticks them through. */
export function AskLoop() {
  const frame = useCurrentFrame();
  const sent = frame >= T_SENT;
  const typing = sent ? "" : typed(ASK, frame, T_TYPE, 1.1);
  const accepted = frame >= T_ACCEPT;
  const travel = progress(frame, T_CARD + 14, 14);

  return (
    <LoopStage>
      {sent ? (
        <div style={{ position: "absolute", right: 40, top: 32, maxWidth: 360, padding: "10px 16px", borderRadius: 14, borderBottomRightRadius: 4, background: C.raised, fontSize: 15, ...pop(frame, T_SENT, 8) }}>
          {ASK}
        </div>
      ) : null}

      {frame < T_CARD + 8 ? (
        <div style={{ position: "absolute", left: 40, right: 40, top: 40, opacity: Math.min(progress(frame, 0, 10), 1 - progress(frame, T_SENT, 8)) }}>
          <p style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>What would you like to make happen?</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {STARTERS.map(([icon, title, text]) => (
              <div key={title} style={{ display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(184,183,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <I name={icon} size={15} color={C.accent} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{title}</span>
                  <span style={{ display: "block", fontSize: 11, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {frame >= T_CARD ? (
        <Panel style={{ position: "absolute", left: 40, right: 40, top: 84, padding: "14px 16px 12px", background: flash(frame, accepted ? T_ACCEPT : 200, C.green), ...rise(frame, T_CARD) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <I name="sparkle" size={14} color={C.accent} /> Proposal · 4 changes
          </div>
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {CHANGES.map(([glyph, title, when], i) => {
              const tick = accepted && frame >= T_ACCEPT + 4 + i * 6;
              return (
                <div key={title} style={{ display: "flex", alignItems: "center", gap: 12, height: 32, fontSize: 15, ...rise(frame, T_CARD + 6 + i * 4, 12, 8) }}>
                  {tick ? <Check size={20} /> : <span style={{ width: 20, textAlign: "center", color: glyph === "+" ? C.green : C.amber, fontWeight: 700 }}>{glyph}</span>}
                  <span style={{ flex: 1, color: tick ? C.soft : C.ink }}>{title}</span>
                  <span style={{ color: C.faint, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{when}</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, ...rise(frame, T_CARD + 24, 12, 8) }}>
            <Btn primary style={{ background: accepted ? C.green : C.accent, color: accepted ? "#07140d" : C.accentInk }}>{accepted ? "Applied" : "Accept all"}</Btn>
            <Btn>Edit</Btn>
          </div>
        </Panel>
      ) : null}

      {frame >= T_CARD + 12 && !accepted ? <Pointer x={300 - travel * 200} y={120 + travel * 150} pressed={frame >= T_ACCEPT - 2} opacity={progress(frame, T_CARD + 12, 6)} /> : null}

      <div style={{ position: "absolute", left: 40, right: 40, bottom: 36, height: 48, borderRadius: 14, border: `1px solid ${!sent && frame >= T_TYPE ? C.accent : C.line2}`, background: "#0b0c11", display: "flex", alignItems: "center", padding: "0 16px", gap: 10, fontSize: 16, color: typing ? C.ink : C.faint }}>
        <span style={{ flex: 1 }}>
          {typing || "Ask for a plan, a sheet, a project…"}
          <Caret on={!sent && frame >= T_TYPE} height={18} />
        </span>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <I name="arrow" size={16} color={C.accentInk} />
        </span>
      </div>
    </LoopStage>
  );
}
