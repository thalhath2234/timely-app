import { useCurrentFrame } from "remotion";
import { fade, pop, rise, typed, typingLength } from "../anim";
import { Btn, Caption, Caret, Check, I, Pointer, Stage, Window } from "../kit";
import { C } from "../theme";
import { FilesPane, ToolbarStrip } from "./filesPane";

const LEAD = "Launch target is Friday 23 October. Three things left:";
const SLASH_AT = 14;
const PICK_AT = SLASH_AT + 26;
const LINE = "Send the invoice to Sam";
const T_LINE = PICK_AT + 8;
const SUGGEST_AT = T_LINE + typingLength(LINE) + 8;
const LINK_AT = SUGGEST_AT + 24;

const MENU = ["Heading", "Task list", "Table", "Sheet", "Image", "Help me write"];

/** 05 Docs: the launch brief, a slash menu, a task line, and the line becomes a real task. */
export function DocsScene() {
  const frame = useCurrentFrame();
  const menuOpen = frame >= SLASH_AT && frame < PICK_AT;
  const listOn = frame >= PICK_AT;

  return (
    <Stage>
      <Window page="Files" style={{ display: "flex" }}>
        <FilesPane active="Website launch brief" />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "0 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0 0", fontSize: 11, color: C.faint }}>
            Files <I name="chevron" size={10} /> Website launch brief
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Btn style={{ height: 26, fontSize: 11 }}>Share</Btn>
            </span>
          </div>
          <div style={{ margin: "0 auto", width: 640, paddingTop: 20 }}>
            <div style={{ fontSize: 34 }}>🚀</div>
            <h3 style={{ margin: "8px 0 0", fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>Website launch brief</h3>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: C.faint }}>95 words · edited just now</p>
            <ToolbarStrip count={22} />
            <p style={{ margin: "16px 0 0", fontSize: 15, lineHeight: 1.6, color: C.soft }}>The studio site is three years old. This refresh brings the work forward and makes it easy to get in touch.</p>
            <div style={{ margin: "14px 0 0", borderRadius: 10, border: `1px solid ${C.line2}`, background: "#14151c", padding: "8px 12px", fontSize: 14 }}>
              <div style={{ fontSize: 11, color: C.faint, display: "flex", gap: 8, alignItems: "center" }}>
                <I name="sparkle" size={11} /> Note
              </div>
              <div style={{ marginTop: 4, color: C.ink, minHeight: 22 }}>
                {LEAD}
                {frame < SLASH_AT ? <Caret height={16} /> : null}
              </div>
            </div>

            <div style={{ position: "relative", marginTop: 14, minHeight: 40 }}>
              {!listOn ? (
                <p style={{ margin: 0, fontSize: 15, color: C.ink, opacity: fade(frame, SLASH_AT, 4) }}>
                  /{menuOpen ? typed("task", frame, SLASH_AT + 6, 0.35) : ""}
                  <Caret height={16} />
                </p>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, ...rise(frame, PICK_AT, 10) }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${frame >= LINK_AT ? C.accent : C.line2}`, background: frame >= LINK_AT ? `color-mix(in oklab, ${C.accent} 20%, transparent)` : "transparent", flexShrink: 0 }} />
                  <span style={{ color: C.ink }}>
                    {typed(LINE, frame, T_LINE)}
                    {frame >= T_LINE && frame < SUGGEST_AT ? <Caret height={16} /> : null}
                  </span>
                  {frame >= LINK_AT ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, background: `color-mix(in oklab, ${C.accent} 18%, transparent)`, color: C.accent, fontSize: 12, fontWeight: 500, ...pop(frame, LINK_AT) }}>
                      <Check size={13} color={C.accent} /> Task · Fri · 15 min
                    </span>
                  ) : null}
                </div>
              )}

              {menuOpen ? (
                <div style={{ position: "absolute", left: 0, top: 30, width: 230, borderRadius: 10, border: `1px solid ${C.line2}`, background: C.raised, padding: 6, boxShadow: "0 30px 80px -30px rgba(0,0,0,0.9)", zIndex: 3, ...pop(frame, SLASH_AT, 8) }}>
                  {MENU.map((item, i) => {
                    const matches = frame < SLASH_AT + 8 || item === "Task list";
                    const picked = item === "Task list" && frame >= SLASH_AT + 12;
                    return (
                      <div key={item} style={{ padding: "7px 10px", borderRadius: 7, fontSize: 13, color: matches ? C.ink : C.faint, background: picked ? "rgba(255,255,255,0.08)" : "transparent", opacity: matches ? 1 : 0.35, display: i > 2 && frame >= SLASH_AT + 8 ? "none" : "block" }}>
                        {item}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {frame >= SUGGEST_AT && frame < LINK_AT ? (
                <div style={{ position: "absolute", left: 28, top: 32, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: `1px solid ${C.line2}`, background: C.raised, fontSize: 13, boxShadow: "0 30px 80px -30px rgba(0,0,0,0.9)", zIndex: 3, ...pop(frame, SUGGEST_AT) }}>
                  <I name="sparkle" size={13} color={C.pink} />
                  <span style={{ color: C.soft }}>Looks like a task.</span>
                  <span style={{ padding: "4px 10px", borderRadius: 7, background: C.accent, color: C.accentInk, fontWeight: 600 }}>Create task</span>
                  <span style={{ color: C.faint }}>Dismiss</span>
                </div>
              ) : null}
            </div>

            <h4 style={{ margin: "26px 0 0", fontSize: 18, fontWeight: 600 }}>Goals</h4>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 14, lineHeight: 1.7, color: C.soft }}>
              <li>Show three recent projects on the homepage</li>
              <li>Cut the contact form to three fields</li>
              <li>Load in under one second on a phone</li>
            </ul>
            <h4 style={{ margin: "18px 0 0", fontSize: 18, fontWeight: 600 }}>Pages</h4>
            <div style={{ margin: "8px 0 0", borderRadius: 10, border: `1px solid ${C.line}`, overflow: "hidden", fontSize: 13 }}>
              {[
                ["Home", "Three projects, one line about the studio", "Draft"],
                ["Work", "Case studies with a photo each", "Ready"],
                ["Contact", "Name, email, message", "Ready"],
              ].map(([page, note, state], i) => (
                <div key={page} style={{ display: "grid", gridTemplateColumns: "90px 1fr 60px", gap: 10, padding: "8px 12px", borderTop: i ? `1px solid ${C.line}` : "none", color: C.soft }}>
                  <span style={{ color: C.ink, fontWeight: 500 }}>{page}</span>
                  <span>{note}</span>
                  <span style={{ color: state === "Ready" ? C.green : C.amber, fontSize: 12 }}>{state}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {frame >= SUGGEST_AT + 6 && frame < LINK_AT + 2 ? <Pointer x={520 + Math.min(1, (frame - SUGGEST_AT - 6) / 12) * 30} y={372} pressed={frame >= LINK_AT - 3} /> : null}
        <div style={{ position: "absolute", right: 22, top: 50, width: 170, display: "grid", gap: 6, fontSize: 12, color: C.soft, ...rise(frame, 20) }}>
          {["Markdown in and out", "Images, tables, code", "Help me write", "Lines become tasks"].map((line, i) => (
            <div key={line} style={{ display: "flex", gap: 8, alignItems: "center", opacity: i === 3 && frame < LINK_AT ? 0.5 : 1 }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: i === 3 && frame >= LINK_AT ? C.accent : C.faint }} />
              {line}
            </div>
          ))}
        </div>
      </Window>
      <Caption n="05" title="Docs" note="Notes beside the project; a line turns into a task with a link back" color={C.blue} />
    </Stage>
  );
}
