import { useCurrentFrame } from "remotion";
import { fade, linear, pop, rise } from "../anim";
import { Caption, Check, Chip, Stage } from "../kit";
import { C, FONT } from "../theme";

const PAIR_AT = 60;

/** 10 Self-host: your computer, your phone, your Tailscale network between them. */
export function SelfHostScene() {
  const frame = useCurrentFrame();
  const pulse = (linear(frame, 20, 140) * 3) % 1;
  const paired = frame >= PAIR_AT + 20;
  const card = { borderRadius: 20, border: `1px solid ${C.line2}`, background: C.panel, padding: 26 } as const;

  return (
    <Stage>
      <div style={{ position: "absolute", left: 60, right: 60, top: 60, display: "grid", gridTemplateColumns: "1fr 220px 1fr", alignItems: "stretch", gap: 20 }}>
        <div style={{ ...card, ...rise(frame, 4) }}>
          <p style={{ margin: 0, fontSize: 14, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Your computer</p>
          <h3 style={{ margin: "10px 0 0", fontFamily: FONT.display, fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>Timely desktop</h3>
          <div style={{ marginTop: 18, display: "grid", gap: 10, fontSize: 17, color: C.soft }}>
            {["PostgreSQL bundled, data in your app folder", "API and MCP server on this machine", "Encrypted backups on a schedule"].map((line, i) => (
              <div key={line} style={{ display: "flex", gap: 10, alignItems: "center", opacity: fade(frame, 12 + i * 8) }}>
                <Check size={16} /> {line}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 12, fontFamily: FONT.mono, fontSize: 15, color: C.green }}>
            <span style={{ width: 10, height: 10, borderRadius: 99, background: C.green }} /> tailnet 100.64.0.2 · listening
          </div>
          <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 16, ...rise(frame, PAIR_AT - 10) }}>
            <Qr />
            <span style={{ fontSize: 15, color: C.soft }}>
              Pair by QR code.
              <br />
              <span style={{ color: C.faint }}>Settings → Server → Pair phone</span>
            </span>
          </div>
        </div>

        <div style={{ position: "relative", height: 120, alignSelf: "center" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 58, borderTop: `2px dashed ${C.line2}` }} />
          <div style={{ position: "absolute", left: `${pulse * 100}%`, top: 51, width: 16, height: 16, borderRadius: 99, background: C.green, boxShadow: `0 0 24px ${C.green}`, translate: "-8px 0", opacity: fade(frame, 20) }} />
          <div style={{ position: "absolute", left: "50%", top: 0, translate: "-50% 0", textAlign: "center", fontSize: 15, color: C.soft, whiteSpace: "nowrap" }}>
            <span style={{ color: C.ink, fontWeight: 600 }}>Tailscale</span>
            <br />
            <span style={{ color: C.faint }}>your private network</span>
          </div>
          <div style={{ position: "absolute", left: "50%", top: 84, translate: "-50% 0", fontSize: 14, color: C.faint, whiteSpace: "nowrap", textDecoration: "line-through", opacity: fade(frame, 90) }}>someone else&apos;s cloud</div>
        </div>

        <div style={{ ...card, ...rise(frame, 10) }}>
          <p style={{ margin: 0, fontSize: 14, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Your phone</p>
          <h3 style={{ margin: "10px 0 0", fontFamily: FONT.display, fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>Timely for Android</h3>
          <div style={{ marginTop: 18, minHeight: 120 }}>
            {paired ? (
              <div style={{ display: "grid", gap: 10, fontSize: 17, color: C.soft, ...pop(frame, PAIR_AT + 20) }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", color: C.green, fontWeight: 600 }}>
                  <Check size={18} /> Paired with your computer
                </div>
                <div>Works at home, on the train, anywhere on your tailnet.</div>
                <div>Widgets, notifications, the whole app.</div>
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {[
                    ["Today", "3 tasks · 2 events", 0],
                    ["Send the invoice to Sam", "reminder · 4:00 PM", 10],
                    ["Pomodoro", "24:58 · running", 20],
                  ].map(([a, b, d]) => (
                    <div key={a as string} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: C.raised, border: `1px solid ${C.line}`, fontSize: 14, ...rise(frame, PAIR_AT + 30 + (d as number), 12) }}>
                      <span style={{ width: 8, height: 8, borderRadius: 99, background: C.green }} />
                      <span style={{ color: C.ink, fontWeight: 500 }}>{a}</span>
                      <span style={{ marginLeft: "auto", color: C.faint, fontSize: 13 }}>{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 17, color: C.faint }}>
                {frame >= PAIR_AT ? "Scanning…" : "Not paired yet"}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ position: "absolute", left: 60, right: 60, top: 486, display: "flex", gap: 12, flexWrap: "wrap", ...rise(frame, 110) }}>
        <Chip color={C.ink}>Open source · MIT</Chip>
        <Chip color={C.ink}>No account with anyone</Chip>
        <Chip color={C.ink}>Nothing to pay</Chip>
        <Chip color={C.ink}>Windows · Linux · Android</Chip>
        <Chip color={C.ink}>Full JSON export</Chip>
      </div>
      <p style={{ position: "absolute", left: 60, right: 60, top: 548, margin: 0, fontFamily: FONT.display, fontSize: 36, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.05, ...rise(frame, 122) }}>
        Your data never leaves your computer unless you take it with you.
      </p>
      <Caption n="11" title="Self-host" note="Runs on your computer, reaches your phone over Tailscale" color={C.green} />
    </Stage>
  );
}

function Qr() {
  const cells: number[] = [];
  for (let i = 0; i < 49; i++) cells.push((i * 7 + 3) % 5 < 2 || i % 8 === 0 ? 1 : 0);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 7px)", gap: 2, padding: 6, background: "#fff", borderRadius: 6 }}>
      {cells.map((on, i) => (
        <span key={i} style={{ width: 7, height: 7, background: on ? "#000" : "#fff" }} />
      ))}
    </div>
  );
}
