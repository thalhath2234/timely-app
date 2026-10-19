import { interpolate, useCurrentFrame } from "remotion";
import { EASE, blink, fade, pop, rise } from "../anim";
import { Btn, Caption, Check, I, Pill, Stage, Window } from "../kit";
import { C, FONT } from "../theme";

const ROWS = [
  { label: "Priority", value: "Urgent", p: 0.74, at: 34, color: C.red },
  { label: "Duration", value: "45 min", p: 0.91, at: 50 },
  { label: "Deadline", value: "Oct 14, 2026", p: 0.69, at: 66 },
  { label: "Project", value: "Move to the new flat", p: 0.88, at: 82, color: C.green },
];

/** 06 Smart suggestions: a task's empty properties are filled by Jev, with its confidence shown. */
export function SuggestionsScene() {
  const frame = useCurrentFrame();
  const thinking = frame >= 14 && frame < ROWS[ROWS.length - 1].at + 12;

  return (
    <Stage>
      <Window page="Tasks" style={{ display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, padding: "18px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: C.faint }}>
            Personal <I name="chevron" size={10} /> Move to the new flat <I name="chevron" size={10} /> Tasks
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Btn style={{ height: 26, fontSize: 11 }} icon="check">
                Mark complete
              </Btn>
            </span>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: C.faint }}>
            <Pill color={C.soft}>IN-0042</Pill> Created Oct 11 · from the Inbox
          </div>
          <h3 style={{ margin: "8px 0 0", fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>Book the moving van</h3>
          <p style={{ margin: "14px 0 0", fontSize: 11, color: C.faint, letterSpacing: "0.06em" }}>DESCRIPTION</p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: C.soft, lineHeight: 1.6 }}>Two people, Saturday morning if possible. Ask about boxes.</p>
          <p style={{ margin: "18px 0 0", fontSize: 11, color: C.faint, letterSpacing: "0.06em" }}>CHECKLIST · 0 of 3</p>
          {["Get two quotes", "Confirm the date with the landlord", "Pay the deposit"].map((item) => (
            <div key={item} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, fontSize: 13 }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${C.line2}` }} />
              {item}
            </div>
          ))}

          <div style={{ marginTop: 26, borderRadius: 12, border: `1px solid color-mix(in oklab, ${C.pink} 35%, transparent)`, background: `color-mix(in oklab, ${C.pink} 7%, transparent)`, padding: "12px 14px", ...rise(frame, 8) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: C.pink, opacity: thinking && blink(frame, 8) ? 0.4 : 1 }} />
              Smart suggestions
              <span style={{ fontSize: 12, color: C.faint, fontWeight: 400 }}>· Jev by TypeSafe</span>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.55, color: C.soft }}>A decision model, not a chatbot. Timely asks typed questions and gets a choice with a probability back. No prompts, no free text, nothing to make up.</p>
            <div style={{ marginTop: 10, display: "grid", gap: 4, fontSize: 12, color: C.soft, fontFamily: FONT.mono }}>
              {[
                ["question", "How long will this take?"],
                ["choices", "15 · 30 · 45 · 60 · 90 min"],
                ["answer", "45 min · 0.91"],
              ].map(([k, v], i) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 8, opacity: fade(frame, 20 + i * 10) }}>
                  <span style={{ color: C.faint }}>{k}</span>
                  <span style={{ color: i === 2 ? C.pink : C.soft }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ width: 330, flexShrink: 0, borderLeft: `1px solid ${C.line}`, padding: "18px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <Btn primary style={{ height: 28, fontSize: 12, flex: 1, justifyContent: "center" }}>
              Work
            </Btn>
            <Btn style={{ height: 28, fontSize: 12, flex: 1, justifyContent: "center" }}>Reminder</Btn>
          </div>
          <Prop label="Workspace" value="Personal" dot={C.green} />
          <Prop label="Status" value="Todo" />
          {ROWS.map((row) => {
            const on = frame >= row.at;
            const p = interpolate(frame, [row.at, row.at + 22], [0, row.p], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
            return (
              <div key={row.label} style={{ borderTop: `1px solid ${C.line}`, padding: "9px 0", fontSize: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 80, color: C.faint }}>{row.label}</span>
                  {on ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...pop(frame, row.at, 10) }}>
                      {row.color ? <span style={{ width: 8, height: 8, borderRadius: 99, background: row.color }} /> : null}
                      {row.value}
                      <Pill color={C.pink}>SUGGESTED</Pill>
                    </span>
                  ) : (
                    <span style={{ color: C.faint }}>{thinking ? (blink(frame, 10) ? "…" : " ") : "Empty"}</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginLeft: 88 }}>
                  <span style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${p * 100}%`, background: C.pink, borderRadius: 2 }} />
                  </span>
                  <span style={{ width: 34, fontFamily: FONT.mono, fontSize: 11, color: on ? C.soft : C.faint, textAlign: "right" }}>{on ? p.toFixed(2) : "–"}</span>
                </div>
              </div>
            );
          })}
          <Prop label="Labels" value="Move to the new flat" dot={C.green} />
          <div style={{ marginTop: "auto", display: "flex", gap: 8, ...rise(frame, 108) }}>
            <Btn primary icon="check" style={{ flex: 1, justifyContent: "center" }}>
              Accept all
            </Btn>
            <Btn>Change</Btn>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: C.faint, ...rise(frame, 116) }}>Your TypeSafe or OpenRouter key. Without one, the fields are yours to fill.</p>
        </div>
      </Window>
      <Caption n="07" title="Smart suggestions" note="Typed questions in, probabilities out, your call to accept" color={C.pink} />
    </Stage>
  );
}

function Prop({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${C.line}`, padding: "9px 0", fontSize: 13 }}>
      <span style={{ width: 80, color: C.faint }}>{label}</span>
      {dot ? <span style={{ width: 8, height: 8, borderRadius: 99, background: dot }} /> : null}
      {value}
      <Check size={0} />
    </div>
  );
}
