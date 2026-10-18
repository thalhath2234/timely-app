import { useCurrentFrame } from "remotion";
import { fade, pop, rise, typed, typingLength } from "../anim";
import { Btn, Caption, Caret, Check, I, Pointer, Stage, Window } from "../kit";
import { C, FONT } from "../theme";

const MENU_OPEN = 6;
const MENU_CLOSE = 34;
const ASK = "plan my launch week, keep Friday free";
const CPS = 1.1;
const T_ASK = 38;
const SENT = T_ASK + typingLength(ASK, CPS) + 6;
const REPLY = SENT + 16;
const CLICK = REPLY + 32;

const WEEK: Array<[string, Array<[string, string]>]> = [
  ["Mon", [["Fix build on Windows", C.green]]],
  ["Tue", [["Write release notes", C.green], ["Client review", C.faint]]],
  ["Wed", [["Lunch with Sam", C.faint]]],
  ["Thu", [["Design the homepage", C.amber], ["Record the demo", C.green]]],
  ["Fri", []],
];

const MODELS = [
  { name: "Claude Code", note: "your Claude subscription", on: true },
  { name: "Codex", note: "your ChatGPT subscription" },
  { name: "API key", note: "Anthropic, OpenAI, OpenRouter, any model" },
];

const CHANGES = [
  ["+", "Fix build on Windows", "Mon · 2h"],
  ["+", "Write release notes", "Tue · 1h"],
  ["↷", "Design the homepage", "Wed → Thu"],
  ["+", "Record the demo", "Thu · 45 min"],
];

const QUICK = [
  ["Start a project", "Create a project for a PDF tool with a document with an initial plan."],
  ["Build a budget", "Create a project budget sheet with Item, Quantity, Unit price and Total columns."],
  ["Make room to learn", "Create a workspace for learning Japanese and add three study sessions."],
  ["Save a receipt", "Attach a receipt photo and add it to your expense sheet."],
];

/** 08 Assistant: pick the AI account you already have, ask, approve the proposal. */
export function AssistantScene() {
  const frame = useCurrentFrame();
  const menu = frame >= MENU_OPEN && frame < MENU_CLOSE;
  const applied = frame >= CLICK;
  const started = frame >= SENT;

  return (
    <Stage>
      <Window page="Chat" style={{ display: "flex" }}>
        <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, padding: "0 4px" }}>
            Chats <span style={{ marginLeft: "auto", color: C.faint }}><I name="plus" size={15} /></span>
          </div>
          <div style={{ marginTop: 10, height: 30, borderRadius: 8, border: `1px solid ${C.line}`, background: "#0b0c11", display: "flex", alignItems: "center", gap: 6, padding: "0 8px", fontSize: 12, color: C.faint }}>
            <I name="search" size={13} /> Search chats
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 2, fontSize: 12 }}>
            {["Launch week", "Receipts · October", "Spanish study plan"].map((chat, i) => (
              <div key={chat} style={{ padding: "7px 8px", borderRadius: 8, background: i === 0 && started ? "rgba(255,255,255,0.07)" : "transparent", color: i === 0 && started ? C.ink : C.soft }}>
                {i === 0 && !started ? "New conversation" : chat}
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", borderBottom: `1px solid ${C.line}` }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{started ? "Launch week" : "New conversation"}</div>
              <div style={{ fontSize: 11, color: C.faint }}>Timely assistant</div>
            </div>
            <div style={{ marginLeft: "auto", position: "relative" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, border: `1px solid ${menu ? C.accent : C.line2}`, fontSize: 12, background: "#0b0c11" }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: C.green }} />
                Claude Code <span style={{ color: C.faint }}>· your subscription</span>
                <span style={{ color: C.faint }}>▾</span>
              </span>
              {menu ? (
                <div style={{ position: "absolute", right: 0, top: 36, width: 300, borderRadius: 10, border: `1px solid ${C.line2}`, background: C.raised, padding: 6, boxShadow: "0 30px 80px -30px rgba(0,0,0,0.9)", zIndex: 3, ...pop(frame, MENU_OPEN, 8) }}>
                  <p style={{ margin: "4px 10px 6px", fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Runs on</p>
                  {MODELS.map((m) => (
                    <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7, background: m.on ? "rgba(255,255,255,0.08)" : "transparent" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: C.faint }}>{m.note}</div>
                      </div>
                      {m.on ? <Check size={14} color={C.accent} /> : null}
                    </div>
                  ))}
                  <p style={{ margin: "6px 10px 4px", fontSize: 11, color: C.faint }}>Nothing to pay Timely. Keys are stored encrypted.</p>
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ flex: 1, padding: "22px 22px 0", display: "flex", flexDirection: "column", gap: 12, fontSize: 14, overflow: "hidden" }}>
            {!started ? (
              <div style={{ margin: "auto", width: 560, opacity: fade(frame, 0, 1, SENT - 10) }}>
                <span style={{ fontSize: 11, color: C.accent, padding: "3px 9px", borderRadius: 999, border: `1px solid color-mix(in oklab, ${C.accent} 40%, transparent)` }}>Timely assistant</span>
                <h3 style={{ margin: "12px 0 0", fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.1 }}>What would you like to make happen?</h3>
                <p style={{ margin: "8px 0 0", fontSize: 13, color: C.soft }}>Turn an idea into a project, shape a plan, or plan your week. Small changes happen right away; bigger ones wait for your approval.</p>
                <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {QUICK.map(([title, body]) => (
                    <div key={title} style={{ borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel, padding: "10px 12px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
                      <div style={{ fontSize: 11, color: C.faint, marginTop: 3, lineHeight: 1.4 }}>{body}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {started ? <div style={{ alignSelf: "flex-end", maxWidth: 420, padding: "10px 14px", borderRadius: 12, background: `color-mix(in oklab, ${C.accentDeep} 40%, ${C.panel})`, ...pop(frame, SENT, 8) }}>{ASK}</div> : null}
            {frame >= REPLY ? (
              <div style={{ alignSelf: "flex-start", width: 520, borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel, padding: "14px 16px", ...rise(frame, REPLY, 12) }}>
                <p style={{ margin: 0, fontSize: 12, color: C.soft }}>
                  Proposal · 4 changes {applied ? <span style={{ color: C.green }}>· applied</span> : null}
                </p>
                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  {CHANGES.map(([sign, title, when], i) => (
                    <div key={title} style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 8, fontSize: 13, ...rise(frame, REPLY + 6 + i * 4, 10) }}>
                      <span style={{ fontFamily: FONT.mono, color: sign === "+" ? C.green : C.amber }}>{sign}</span>
                      <span>{title}</span>
                      <span style={{ color: C.faint, fontSize: 12 }}>{when}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                  {applied ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.green, fontWeight: 600, fontSize: 13, ...pop(frame, CLICK, 8) }}>
                      <Check size={15} /> On your calendar
                    </span>
                  ) : (
                    <>
                      <Btn primary style={{ height: 28, fontSize: 12 }}>Approve</Btn>
                      <Btn style={{ height: 28, fontSize: 12 }}>Edit</Btn>
                    </>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: C.faint }}>Nothing changes until you approve</span>
                </div>
              </div>
            ) : null}
            {applied ? (
              <div style={{ alignSelf: "flex-start", width: 520, borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel, padding: "12px 16px 14px", ...rise(frame, CLICK + 4, 12) }}>
                <p style={{ margin: 0, fontSize: 12, color: C.soft }}>Calendar · Oct 12 – 16</p>
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                  {WEEK.map(([day, items]) => (
                    <div key={day} style={{ borderRadius: 8, background: "#0b0c11", border: `1px solid ${C.line}`, padding: "6px 6px 8px", minHeight: 86 }}>
                      <div style={{ fontSize: 10, color: day === "Fri" ? C.accent : C.faint, fontWeight: 600 }}>{day}</div>
                      {items.map(([title, color]) => (
                        <div key={title} style={{ marginTop: 5, padding: "4px 6px", borderRadius: 5, fontSize: 10, lineHeight: 1.25, background: `color-mix(in oklab, ${color} 22%, transparent)`, borderLeft: `2px solid ${color}`, color: C.ink }}>{title}</div>
                      ))}
                      {day === "Fri" ? <div style={{ marginTop: 5, fontSize: 10, color: C.accent }}>Kept free</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ margin: "14px 22px 16px", borderRadius: 12, border: `1px solid ${frame >= T_ASK && frame < SENT ? C.accent : C.line2}`, background: "#0b0c11", padding: "12px 14px" }}>
            <div style={{ fontSize: 14, color: frame >= T_ASK && frame < SENT ? C.ink : C.faint, minHeight: 20 }}>
              {frame >= T_ASK && frame < SENT ? typed(ASK, frame, T_ASK, CPS) : "Ask Timely to create, plan, or update…"}
              {frame >= T_ASK && frame < SENT ? <Caret height={16} /> : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: 11, color: C.faint }}>
              <span>⊕</span>
              <span>Web search</span>
              <span>Default model ▾</span>
              <span style={{ marginLeft: "auto" }}>Enter to send · Shift+Enter for a new line</span>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: C.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <I name="arrow" size={13} color={C.accentInk} />
              </span>
            </div>
          </div>
          <span style={{ position: "absolute", left: 22, bottom: 2, fontSize: 10, color: C.faint }}>Chat from any screen: Ctrl / ⌘ + Shift + J</span>
          {frame >= REPLY + 20 && frame < CLICK + 10 ? <Pointer x={40 + Math.min(1, (frame - REPLY - 20) / 14) * 20} y={248} pressed={frame >= CLICK - 2} opacity={fade(frame, REPLY + 20, 6)} /> : null}
        </div>
      </Window>
      <Caption n="08" title="AI assistant" note="Claude Code, Codex or an API key: the account you already pay for" color={C.accent} />
    </Stage>
  );
}
