import { interpolate, useCurrentFrame } from "remotion";
import { EASE, fade, pop } from "../anim";
import { Btn, Caption, Card, I, PageHeader, Pointer, Segmented, Stage, Stat, Window } from "../kit";
import { C } from "../theme";

const OPEN_AT = 16;
const PANEL_AT = 30;
const SOURCE_AT = 54;
const DISPLAY_AT = 72;
const GROUP_AT = 90;
const SAVE_AT = 116;
const PHONE_AT = 138;

const BARS = [
  { name: "Website refresh", hours: 11, color: C.violet },
  { name: "Move to the new flat", hours: 6, color: C.green },
  { name: "Learn Spanish", hours: 3, color: C.amber },
  { name: "Release v0.4", hours: 5, color: C.red },
];

/** 06 Dashboard cards: Add card opens the workshop, a custom chart card is built and saved. */
export function CardsScene() {
  const frame = useCurrentFrame();
  const panel = frame >= PANEL_AT && frame < SAVE_AT + 22;
  const saved = frame >= SAVE_AT;
  const panelX = frame < SAVE_AT + 4 ? interpolate(frame, [PANEL_AT, PANEL_AT + 18], [380, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }) : interpolate(frame, [SAVE_AT + 4, SAVE_AT + 20], [0, 400], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const source = frame >= SOURCE_AT ? "Tasks" : "Tasks";
  const display = frame >= DISPLAY_AT ? "Bar" : "Number";
  const grouped = frame >= GROUP_AT;

  return (
    <Stage>
      <Window page="Dashboard" style={{ overflow: "hidden" }}>
        <PageHeader
          title="Dashboard"
          subtitle="Drag a card by its title to move it, drag its edge or corner to resize."
          actions={
            <Btn primary icon="plus" style={{ boxShadow: frame >= OPEN_AT - 4 && frame < PANEL_AT ? `0 0 0 4px color-mix(in oklab, ${C.accent} 30%, transparent)` : "none" }}>
              Add card
            </Btn>
          }
        />
        <div style={{ padding: "0 24px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Card icon="hash" title="Open tasks" style={{ height: 120 }}>
            <Stat value="14" />
          </Card>
          <Card icon="hash" title="Done this week" style={{ height: 120 }}>
            <Stat value="2" note={<span style={{ color: C.green }}>↗ +2 vs the week before</span>} />
          </Card>
          <Card icon="hash" title="Overdue" style={{ height: 120 }}>
            <Stat value="0" color={C.red} />
          </Card>
          <Card icon="timer" title="Pomodoro timer" style={{ height: 120 }}>
            <div style={{ marginTop: "auto", display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>25:00</span>
              <span style={{ fontSize: 12, color: C.faint }}>Ready</span>
              <span style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 8, background: C.accent, color: C.accentInk, fontSize: 12, fontWeight: 600 }}>▶ Start</span>
            </div>
          </Card>
          <Card icon="sun" title="Today" style={{ height: 230, gridColumn: "span 2" }}>
            <p style={{ margin: "10px 0 0", fontSize: 13 }}>
              <strong>2</strong> <span style={{ color: C.faint }}>of 5 done</span>
            </p>
            <div style={{ marginTop: 6, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
              <div style={{ width: "40%", height: "100%", borderRadius: 3, background: C.green }} />
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 11, color: C.faint, letterSpacing: "0.06em" }}>UP NEXT</p>
            {[
              ["10:00 AM", "Farmers market"],
              ["4:00 PM", "Plan the week"],
              ["6:00 PM", "Call mum"],
            ].map(([time, title]) => (
              <div key={title} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, fontSize: 13 }}>
                <span style={{ width: 62, color: C.faint, fontSize: 12 }}>{time}</span>
                <span style={{ width: 2, height: 14, background: C.green, borderRadius: 1 }} />
                {title}
              </div>
            ))}
          </Card>
          {saved ? (
            <div style={{ gridColumn: "span 2", ...pop(frame, SAVE_AT, 12) }}>
              <Card icon="chart" title="Planned hours by project" headerRight={<span style={{ fontSize: 11, color: C.faint, fontWeight: 400 }}>This week</span>} style={{ height: 230 }}>
                <BarChart frame={frame} start={SAVE_AT + 6} />
              </Card>
            </div>
          ) : (
            <Card icon="list" title="Due in the next 14 days" style={{ height: 230, gridColumn: "span 2" }}>
              {[
                ["Write the launch brief", "Website refresh · High", "Oct 13 · in 2d"],
                ["Send October invoices", "No project · High", "Oct 14 · in 3d"],
                ["Book the moving van", "Move to the new flat · Urgent", "Oct 14 · in 3d"],
              ].map(([title, sub, when]) => (
                <div key={title} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: 13, borderBottom: `1px solid ${C.line}`, paddingBottom: 8 }}>
                  <I name="tasks" size={13} color={C.faint} />
                  <span style={{ flex: 1 }}>
                    {title}
                    <span style={{ display: "block", fontSize: 11, color: C.faint }}>{sub}</span>
                  </span>
                  <span style={{ fontSize: 11, color: C.faint }}>{when}</span>
                </div>
              ))}
            </Card>
          )}
          <Card icon="files" title="Launch budget · Total" style={{ height: 120 }}>
            <Stat value="774.00" color={C.green} note="from the sheet, live" />
          </Card>
          <Card icon="check" title="Habits" style={{ height: 120 }}>
            {[
              ["Read 20 pages", [1, 1, 0, 1, 0, 0, 0]],
              ["Stretch", [1, 1, 1, 1, 0, 0, 0]],
            ].map(([name, days]) => (
              <div key={name as string} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12 }}>
                <span style={{ flex: 1, color: C.soft }}>{name as string}</span>
                {(days as number[]).map((on, i) => (
                  <span key={i} style={{ width: 11, height: 11, borderRadius: 3, background: on ? C.green : "rgba(255,255,255,0.08)" }} />
                ))}
              </div>
            ))}
          </Card>
          <Card icon="bell" title="Reminders" style={{ height: 120 }}>
            {[
              ["4:00 PM", "Send the invoice to Sam"],
              ["Tomorrow", "Renew passport"],
            ].map(([when, title]) => (
              <div key={title} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, fontSize: 12 }}>
                <span style={{ width: 62, color: C.faint }}>{when}</span>
                <span style={{ color: C.soft }}>{title}</span>
              </div>
            ))}
          </Card>
          <Card icon="sparkle" title="Week focus" style={{ height: 120 }}>
            <p style={{ margin: "10px 0 0", fontSize: 13 }}>
              <strong>18 h</strong> <span style={{ color: C.faint }}>of 32 h planned</span>
            </p>
            <div style={{ marginTop: 8, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
              <div style={{ width: "56%", height: "100%", borderRadius: 3, background: C.accent }} />
            </div>
          </Card>
        </div>

        {/* Card workshop panel */}
        {panel ? (
          <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 380, translate: `${panelX}px 0`, background: "#0b0c11", borderLeft: `1px solid ${C.line2}`, boxShadow: "-30px 0 80px -30px rgba(0,0,0,0.9)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, zIndex: 4 }}>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Card workshop</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: C.faint }}>Start from a template or build a card from your data.</p>
            </div>
            <Row label="Template">
              <Segmented options={["Blank", "Stats", "Tools"]} active="Blank" style={{ fontSize: 11 }} />
            </Row>
            <Row label="Source">
              <Segmented options={["Tasks", "Events", "Sheet", "Doc"]} active={source} style={{ fontSize: 11 }} />
            </Row>
            <Row label="Display">
              <Segmented options={["Number", "Bar", "Donut", "List", "Progress"]} active={display} style={{ fontSize: 11 }} />
            </Row>
            <Row label="Measure">
              <Select value={frame >= DISPLAY_AT ? "Estimated hours" : "Count"} />
            </Row>
            <Row label="Group by">
              <Select value={grouped ? "Project" : "Nothing"} />
            </Row>
            <Row label="Range">
              <Select value="This week" />
            </Row>
            <div style={{ borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel, padding: 12, flex: 1, minHeight: 120, display: "flex", flexDirection: "column" }}>
              <p style={{ margin: 0, fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Preview</p>
              {grouped ? (
                <BarChart frame={frame} start={GROUP_AT} />
              ) : (
                <div style={{ marginTop: "auto", fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>{frame >= DISPLAY_AT ? "25 h" : "14"}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Btn>Cancel</Btn>
              <Btn primary icon="save" style={{ boxShadow: frame >= SAVE_AT - 6 && frame < SAVE_AT ? `0 0 0 4px color-mix(in oklab, ${C.accent} 30%, transparent)` : "none" }}>
                Save card
              </Btn>
            </div>
          </div>
        ) : null}

        {frame >= PHONE_AT ? (
          <div style={{ position: "absolute", left: 24, bottom: 18, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: `1px solid ${C.line2}`, background: C.raised, fontSize: 13, ...pop(frame, PHONE_AT) }}>
            <I name="phone" size={14} color={C.green} />
            Also on your phone as a widget
            <span style={{ color: C.faint }}>· any card, any size</span>
          </div>
        ) : null}

        {frame >= 4 && frame < SAVE_AT + 4 ? (
          <Pointer
            x={frame < PANEL_AT ? interpolate(frame, [4, OPEN_AT], [700, 1030], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }) : interpolate(frame, [PANEL_AT, SOURCE_AT, DISPLAY_AT, GROUP_AT, SAVE_AT], [1030, 820, 850, 950, 1060], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE })}
            y={frame < PANEL_AT ? 36 : interpolate(frame, [PANEL_AT, SOURCE_AT, DISPLAY_AT, GROUP_AT, SAVE_AT], [36, 150, 196, 290, 640], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE })}
            pressed={Math.abs(frame - OPEN_AT) < 3 || Math.abs(frame - SOURCE_AT) < 3 || Math.abs(frame - DISPLAY_AT) < 3 || Math.abs(frame - GROUP_AT) < 3 || Math.abs(frame - SAVE_AT) < 3}
            opacity={fade(frame, 4, 6)}
          />
        ) : null}
      </Window>
      <Caption n="06" title="Dashboard cards" note="Thirty-five built-in cards, or build your own from tasks, events, a sheet or a doc" color={C.accent} />
    </Stage>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", alignItems: "center", gap: 10, fontSize: 12 }}>
      <span style={{ color: C.faint }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Select({ value }: { value: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "space-between", width: "100%", height: 30, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.line2}`, background: "#0e0f15", fontSize: 12, color: C.ink, boxSizing: "border-box" }}>
      {value}
      <span style={{ color: C.faint }}>▾</span>
    </span>
  );
}

function BarChart({ frame, start }: { frame: number; start: number }) {
  const max = Math.max(...BARS.map((b) => b.hours));
  return (
    <div style={{ marginTop: 10, display: "grid", gap: 9 }}>
      {BARS.map((bar, i) => {
        const p = interpolate(frame, [start + i * 4, start + 18 + i * 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
        return (
          <div key={bar.name} style={{ fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: C.soft }}>
              <span>{bar.name}</span>
              <span style={{ color: C.faint, fontVariantNumeric: "tabular-nums" }}>{bar.hours} h</span>
            </div>
            <div style={{ marginTop: 4, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
              <div style={{ width: `${(bar.hours / max) * 100 * p}%`, height: "100%", borderRadius: 3, background: bar.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
