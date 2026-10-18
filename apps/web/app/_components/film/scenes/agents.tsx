import { useCurrentFrame } from "remotion";
import { fade, pop, rise, typed } from "../anim";
import { Btn, Caption, I, PageHeader, Pill, Stage, Window } from "../kit";
import { C, FONT } from "../theme";

const LOG: { at: number; who: string; text: string; reply?: boolean }[] = [
  { at: 12, who: "hermes", text: 'tasks.create { "title": "Fix flaky test", "project": "Release v0.4" }' },
  { at: 44, who: "←", text: "201 · task IN-0483 created", reply: true },
  { at: 60, who: "openclaw", text: 'sheets.append "Launch budget" { "item": "Receipt", "cost": 48.2 }' },
  { at: 96, who: "←", text: "200 · row 8 written", reply: true },
  { at: 110, who: "hermes", text: 'docs.read "Website launch brief"' },
  { at: 128, who: "←", text: "200 · 95 words", reply: true },
];

const NAV = ["Account", "Appearance", "Schedule", "Notifications", "Workspaces", "Agent", "Data & privacy", "Integrations"];

/** 09 Agents over MCP: the Integrations settings page, with the live log of an agent's calls. */
export function AgentsScene() {
  const frame = useCurrentFrame();

  return (
    <Stage>
      <Window page="Settings" style={{ display: "flex", flexDirection: "column" }}>
        <PageHeader title="Settings" subtitle="Manage your account and per-workspace configuration." style={{ paddingBottom: 6 }} />
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ width: 170, flexShrink: 0, padding: "4px 14px", display: "grid", gap: 2, alignContent: "start" }}>
            {NAV.map((item) => (
              <div key={item} style={{ padding: "7px 10px", borderRadius: 8, fontSize: 13, background: item === "Integrations" ? "rgba(255,255,255,0.07)" : "transparent", color: item === "Integrations" ? C.ink : C.soft }}>
                {item}
                {item === "Integrations" ? <div style={{ fontSize: 10, color: C.faint }}>API keys for Hermes and MCP</div> : null}
              </div>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0, padding: "4px 24px 16px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Agent keys</div>
              <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>Outside agents talk to Timely over MCP with a key you scope. Revoke one and it stops at once.</div>
            </div>
            <div style={{ borderRadius: 10, border: `1px solid ${C.line}`, overflow: "hidden", fontSize: 13 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr auto", gap: 12, padding: "8px 12px", fontSize: 11, color: C.faint, background: "#0b0c11", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <span>Name</span>
                <span>Scope</span>
                <span>Last used</span>
                <span />
              </div>
              {[
                ["hermes", "Tasks, docs, sheets · read + write", frame >= 44 ? "just now" : "2 min ago"],
                ["openclaw", "Sheets only · append", frame >= 96 ? "just now" : "yesterday"],
              ].map(([name, scope, used]) => (
                <div key={name} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr auto", gap: 12, padding: "10px 12px", borderTop: `1px solid ${C.line}`, alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <I name="bot" size={14} color={C.cyan} />
                    {name}
                  </span>
                  <span style={{ color: C.soft }}>{scope}</span>
                  <span style={{ color: C.faint }}>{used}</span>
                  <Btn style={{ height: 26, fontSize: 11 }}>Revoke</Btn>
                </div>
              ))}
              <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.line}`, color: C.accent, fontSize: 12, fontWeight: 500 }}>+ New key</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.soft }}>
              <span style={{ color: C.faint }}>MCP endpoint</span>
              <span style={{ fontFamily: FONT.mono, padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.line}`, background: "#0b0c11" }}>https://100.64.0.2:8080/mcp</span>
              <Pill color={C.green}>ON YOUR TAILNET</Pill>
            </div>

            <div style={{ flex: 1, borderRadius: 10, border: `1px solid ${C.line}`, background: "#08080b", padding: "12px 14px", fontFamily: FONT.mono, fontSize: 12.5, lineHeight: 1.7, display: "grid", gap: 4, alignContent: "start", overflow: "hidden" }}>
              <div style={{ fontSize: 11, color: C.faint, marginBottom: 2 }}>Live · tool calls</div>
              {LOG.map((line) =>
                frame >= line.at ? (
                  <div key={line.at} style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 10, ...rise(frame, line.at, 8, 6) }}>
                    <span style={{ color: line.reply ? C.green : C.cyan }}>{line.who}</span>
                    <span style={{ whiteSpace: "pre-wrap", color: line.reply ? C.green : C.soft }}>{line.reply ? line.text : typed(line.text, frame, line.at, 2)}</span>
                  </div>
                ) : null,
              )}
            </div>
          </div>

          <div style={{ width: 250, flexShrink: 0, padding: "4px 24px 16px 0", display: "grid", gap: 10, alignContent: "start" }}>
            <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Meanwhile in Timely</div>
            <div style={{ borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel, padding: 12 }}>
              <div style={{ fontSize: 11, color: C.faint }}>Release v0.4 · Backlog</div>
              {frame >= 48 ? (
                <div style={{ marginTop: 8, borderRadius: 8, border: `1px solid ${C.line}`, padding: "8px 10px", fontSize: 13, ...pop(frame, 48) }}>
                  Fix flaky test
                  <div style={{ marginTop: 4 }}>
                    <Pill color={C.cyan}>VIA HERMES</Pill>
                  </div>
                </div>
              ) : null}
              <div style={{ marginTop: 8, borderRadius: 8, border: `1px solid ${C.line}`, padding: "8px 10px", fontSize: 13, color: C.soft }}>Write release notes</div>
            </div>
            <div style={{ borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel, padding: 12, fontFamily: FONT.mono, fontSize: 12 }}>
              <div style={{ fontSize: 11, color: C.faint, fontFamily: FONT.sans }}>Launch budget · rows</div>
              {[
                ["7", "Total", "774.00"],
                ["8", "Receipt", "48.20"],
              ].map((row, i) =>
                i === 0 || frame >= 100 ? (
                  <div key={row[0]} style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 8, marginTop: 8, padding: "4px 6px", borderRadius: 6, background: i === 1 ? `color-mix(in oklab, ${C.green} 14%, transparent)` : "transparent", color: i === 1 ? C.ink : C.soft, ...(i === 1 ? pop(frame, 100) : {}) }}>
                    <span style={{ color: C.faint }}>{row[0]}</span>
                    <span>{row[1]}</span>
                    <span>{row[2]}</span>
                  </div>
                ) : null,
              )}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: C.faint, lineHeight: 1.5, opacity: fade(frame, 118) }}>Same tools the assistant uses. Same approvals if you want them.</p>
          </div>
        </div>
      </Window>
      <Caption n="09" title="Agents over MCP" note="Hermes, OpenClaw or your own agent, with a key you scope and revoke" color={C.cyan} />
    </Stage>
  );
}
