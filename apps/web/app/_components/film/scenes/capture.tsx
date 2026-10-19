import { useCurrentFrame } from "remotion";
import { fade, pop, rise, typed, typingLength } from "../anim";
import { Btn, Caption, Caret, PageHeader, Pill, Stage, Window } from "../kit";
import { C } from "../theme";

const FIRST = "Book a moving van before Friday";
const SECOND = "Homepage redesign, needs a full morning";
const T1 = 10;
const T1_END = T1 + typingLength(FIRST);
const T2 = T1_END + 16;
const T2_END = T2 + typingLength(SECOND);

const OLDER = ["Book flights for December", "Ask Sam for the logo files by Friday", "Look into standing desks", "Renew passport this month"];

/** 01 Capture: two thoughts typed into the Inbox become rows to review later. */
export function CaptureScene() {
  const frame = useCurrentFrame();
  const firstLanded = frame >= T1_END + 6;
  const secondLanded = frame >= T2_END + 6;
  const typing = !firstLanded ? typed(FIRST, frame, T1) : !secondLanded ? typed(SECOND, frame, T2) : "";
  const focused = frame > T1 && !secondLanded;
  const count = 4 + (firstLanded ? 1 : 0) + (secondLanded ? 1 : 0);
  const rows = [...(secondLanded ? [SECOND] : []), ...(firstLanded ? [FIRST] : []), ...OLDER];

  return (
    <Stage>
      <Window page="Inbox">
        <PageHeader
          title={
            <>
              Inbox <Pill color={C.accent}>{count} UNREVIEWED</Pill>
            </>
          }
          subtitle="Capture a title now. Assign a workspace to make it work, or turn it into a reminder when you review."
        />
        <div style={{ padding: "4px 24px 0", display: "flex", gap: 10 }}>
          <div style={{ flex: 1, height: 40, borderRadius: 10, border: `1px solid ${focused ? C.accent : C.line2}`, background: "#0b0c11", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 15, color: typing ? C.ink : C.faint, boxShadow: focused ? `0 0 0 3px color-mix(in oklab, ${C.accent} 22%, transparent)` : "none" }}>
            {typing || "Something to follow up…"}
            <Caret on={focused} height={18} />
          </div>
          <Btn primary style={{ height: 40 }}>
            Capture
          </Btn>
        </div>

        <div style={{ margin: "18px 24px 0", display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ borderRadius: 12, border: `1px solid ${C.line2}`, background: C.panel, padding: 16, ...rise(frame, 6) }}>
          <p style={{ margin: 0, fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Up next · oldest capture</p>
          <h3 style={{ margin: "8px 0 0", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>Renew passport this month</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: C.faint }}>Captured 3 days ago</p>
          <div style={{ marginTop: 14, borderRadius: 10, border: `1px solid ${C.line}`, overflow: "hidden", fontSize: 13 }}>
            {[
              ["Workspace", "Personal"],
              ["Project", "None"],
              ["Deadline", "Oct 31 · suggested"],
            ].map(([label, value], i) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                <span style={{ color: C.faint }}>{label}</span>
                <span style={{ color: value.includes("suggested") ? C.pink : C.ink }}>{value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <Btn primary style={{ height: 32, fontSize: 12 }}>Make it a task</Btn>
            <Btn style={{ height: 32, fontSize: 12 }}>Reminder</Btn>
            <Btn style={{ height: 32, fontSize: 12 }}>Skip</Btn>
          </div>
        </div>
        <div style={{ borderRadius: 12, border: `1px solid ${C.line}`, overflow: "hidden" }}>
          {rows.map((title, i) => {
            const fresh = title === FIRST ? T1_END + 6 : title === SECOND ? T2_END + 6 : -1;
            return (
              <div key={title} style={{ display: "flex", alignItems: "center", gap: 12, height: 46, padding: "0 16px", borderTop: i ? `1px solid ${C.line}` : "none", fontSize: 14, background: fresh >= 0 && frame < fresh + 30 ? `color-mix(in oklab, ${C.accent} ${Math.round(14 * (1 - (frame - fresh) / 30))}%, transparent)` : "transparent", ...(fresh >= 0 ? pop(frame, fresh, 10) : {}) }}>
                <span style={{ flex: 1 }}>{title}</span>
                {fresh >= 0 ? <Pill color={C.green}>NEW</Pill> : null}
                <span style={{ fontSize: 12, fontWeight: 600, color: C.soft, padding: "4px 10px", borderRadius: 8, border: `1px solid ${C.line2}` }}>Review</span>
              </div>
            );
          })}
          <p style={{ margin: 0, padding: "12px 16px", fontSize: 12, color: C.faint, borderTop: `1px solid ${C.line}` }}>
            Need the full task list? <span style={{ color: C.soft, textDecoration: "underline" }}>Open tasks</span>
          </p>
        </div>
        </div>
        <div style={{ margin: "16px 24px 0", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, ...rise(frame, 30) }}>
          {[
            ["12", "made tasks this week", C.accent],
            ["4", "turned into reminders", C.green],
            ["3", "skipped, kept as notes", C.faint],
          ].map(([n, label, color]) => (
            <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel }}>
              <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color }}>{n}</span>
              <span style={{ fontSize: 13, color: C.soft }}>{label}</span>
            </div>
          ))}
        </div>
        <p style={{ position: "absolute", right: 24, bottom: 20, margin: 0, fontSize: 13, color: C.faint, ...rise(frame, T1_END + 30) }}>
          Also from the phone, a widget, or <span style={{ color: C.soft }}>Ctrl/Cmd+K</span> anywhere
        </p>
        <span style={{ position: "absolute", left: 24, bottom: 20, fontSize: 13, color: C.faint, opacity: fade(frame, 120) }}>Sort it later, not now</span>
      </Window>
      <Caption n="01" title="Capture" note="Write it down the moment you think of it" color={C.violet} />
    </Stage>
  );
}
