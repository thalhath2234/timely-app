import { useCurrentFrame } from "remotion";
import { fade, rise } from "../anim";
import { Caption, Check, Phone, Stage } from "../kit";
import { C, FONT } from "../theme";

const TICK_AT = 40;
const START_AT = 86;

/** 09 Widgets: ticks and timers on the Android Home screen, no app open. */
export function WidgetsScene() {
  const frame = useCurrentFrame();
  const running = frame >= START_AT;
  const seconds = running ? Math.max(0, 25 * 60 - Math.floor((frame - START_AT) / 30) - 1) : 25 * 60;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const tap = (at: number) => (frame >= at - 6 && frame < at + 10 ? { on: true, p: Math.min(1, (frame - at + 6) / 8) } : { on: false, p: 0 });
  const tap1 = tap(TICK_AT);
  const tap2 = tap(START_AT);

  const widget = { borderRadius: 22, background: "rgba(20,20,28,0.88)", border: "1px solid rgba(255,255,255,0.1)", padding: 16, backdropFilter: "blur(10px)" } as const;

  return (
    <Stage>
      <Phone x={-250} home>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 15%, #2d2458 0%, #0c0c11 55%), radial-gradient(circle at 80% 90%, #0f2a2e 0%, transparent 50%)" }} />
        <div style={{ position: "absolute", top: 50, left: 18, right: 18, display: "grid", gap: 10, fontSize: 15 }}>
          <div style={{ ...widget, ...rise(frame, 4) }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.faint }}>
              <span style={{ color: C.ink, fontWeight: 600, fontSize: 15 }}>Today</span>
              <span>Thu 15</span>
            </div>
            {[
              { title: "Pay rent", done: true },
              { title: "Send the invoice to Sam", done: frame >= TICK_AT },
              { title: "Record the demo", done: false },
            ].map((item) => (
              <div key={item.title} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, color: item.done ? C.faint : C.ink, textDecoration: item.done ? "line-through" : "none" }}>
                {item.done ? <Check size={18} /> : <span style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${C.line2}` }} />}
                {item.title}
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ ...widget, ...rise(frame, 10) }}>
              <div style={{ fontSize: 13, color: C.faint }}>Pomodoro</div>
              <div style={{ fontFamily: FONT.display, fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4, color: running ? C.ink : C.soft, fontVariantNumeric: "tabular-nums" }}>
                {mm}:{ss}
              </div>
              <div style={{ marginTop: 8, display: "inline-block", padding: "5px 12px", borderRadius: 999, background: running ? "rgba(255,255,255,0.08)" : C.accent, color: running ? C.ink : C.accentInk, fontSize: 13, fontWeight: 600 }}>{running ? "Pause" : "Start"}</div>
            </div>
            <div style={{ ...widget, ...rise(frame, 16) }}>
              <div style={{ fontSize: 13, color: C.faint }}>Expenses · Oct</div>
              <div style={{ fontFamily: FONT.display, fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4 }}>1 770</div>
              <div style={{ marginTop: 8, fontSize: 12, color: C.faint }}>from a sheet</div>
            </div>
          </div>
          <div style={{ ...widget, display: "flex", alignItems: "center", gap: 10, color: C.faint, padding: "12px 16px", ...rise(frame, 22) }}>
            <span style={{ fontSize: 20, color: C.accent }}>＋</span> Quick add…
          </div>
          <div style={{ ...widget, padding: "12px 16px", ...rise(frame, 28) }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.faint }}>
              <span style={{ color: C.ink, fontWeight: 600, fontSize: 15 }}>Habits</span>
              <span>this week</span>
            </div>
            {[
              ["Read 20 pages", [1, 1, 0, 1, 0, 0, 0]],
              ["Stretch", [1, 1, 1, 1, 0, 0, 0]],
            ].map(([name, days]) => (
              <div key={name as string} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13 }}>
                <span style={{ flex: 1, color: C.ink }}>{name as string}</span>
                {(days as number[]).map((on, i) => (
                  <span key={i} style={{ width: 14, height: 14, borderRadius: 4, background: on ? C.green : "rgba(255,255,255,0.08)", border: on ? "none" : `1px solid ${C.line2}` }} />
                ))}
              </div>
            ))}
          </div>
          <div style={{ ...widget, padding: "12px 16px", ...rise(frame, 34) }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.faint }}>
              <span style={{ color: C.ink, fontWeight: 600, fontSize: 15 }}>Planned hours by project</span>
              <span>your card</span>
            </div>
            {[
              ["Website refresh", 11, C.violet],
              ["Move to the new flat", 6, C.green],
              ["Release v0.4", 5, C.red],
            ].map(([name, h, color]) => (
              <div key={name as string} style={{ marginTop: 7, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: C.soft }}>
                  <span>{name as string}</span>
                  <span style={{ color: C.faint }}>{h as number} h</span>
                </div>
                <div style={{ marginTop: 3, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
                  <div style={{ width: `${((h as number) / 11) * 100}%`, height: "100%", borderRadius: 3, background: color as string }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        {tap1.on ? <Finger x={44} y={160} p={tap1.p} /> : null}
        {tap2.on ? <Finger x={60} y={300} p={tap2.p} /> : null}
      </Phone>

      <div style={{ position: "absolute", left: 690, top: 150, width: 530, ...rise(frame, 12) }}>
        <p style={{ margin: 0, fontSize: 14, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Android widgets</p>
        <h2 style={{ margin: "14px 0 0", fontFamily: FONT.display, fontSize: 40, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.05 }}>Tick, count and time without opening the app.</h2>
        <div style={{ marginTop: 28, display: "grid", gap: 14, fontSize: 19, color: C.soft }}>
          {[
            ["Today, habits, reminders", "tick boxes save in place", 40],
            ["Pomodoro and timers", "run on the phone, not in the app", 60],
            ["Any Dashboard card", "the card workshop's cards too", 80],
            ["Counters from a sheet", "tap to add one, totals follow", 90],
            ["Quick add", "a thought goes straight to the Inbox", 104],
            ["Resize freely", "every widget redraws at its new size", 116],
          ].map(([a, b, at]) => (
            <div key={a as string} style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 16, opacity: fade(frame, at as number) }}>
              <span style={{ color: C.ink, fontWeight: 500 }}>{a}</span>
              <span>{b}</span>
            </div>
          ))}
        </div>
      </div>
      <p style={{ position: "absolute", left: 690, top: 640, width: 530, margin: 0, fontSize: 15, color: C.faint, ...rise(frame, 126) }}>
        The widget picker lists every card on your Dashboard, built-in or your own.
      </p>
      <Caption n="10" title="Widgets" note="Your day on the Home screen" color={C.orange} />
    </Stage>
  );
}

function Finger({ x, y, p }: { x: number; y: number; p: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 44, height: 44, borderRadius: 99, border: `2px solid ${C.accent}`, background: `color-mix(in oklab, ${C.accent} 30%, transparent)`, scale: `${0.6 + p * 0.5}`, opacity: 1 - p * 0.6 }} />
  );
}
