import { useCurrentFrame } from "remotion";
import { fade, pop, rise, typed, typingLength } from "../anim";
import { Btn, Caption, Caret, I, Stage, Window } from "../kit";
import { C, FONT } from "../theme";
import { FilesPane, ToolbarStrip } from "./filesPane";

const COLS = ["A", "B", "C", "D"];
const HEAD = ["Item", "Category", "Cost", "Paid"];
const ROWS = [
  ["Domain renewal", "Hosting", "18.00", "TRUE"],
  ["Hosting (12 months)", "Hosting", "96.00", "TRUE"],
  ["Stock photos", "Content", "120.00", "FALSE"],
  ["Font licence", "Design", "240.00", "FALSE"],
  ["Copy editing", "Content", "300.00", "FALSE"],
];
const FORMULA = "=SUM(C2:C6)";
const F_AT = 62;
const F_DONE = F_AT + typingLength(FORMULA, 0.5);
const RESULT_AT = F_DONE + 8;

/** 04 Sheets: a project sheet fills in, a formula totals it, the total becomes a card. */
export function SheetsScene() {
  const frame = useCurrentFrame();
  const cellAt = (row: number, col: number) => 6 + row * 9 + col * 2;
  const cell = { padding: "0 10px", height: 30, display: "flex", alignItems: "center", borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, fontSize: 12.5, whiteSpace: "nowrap" as const, overflow: "hidden" };
  const catColor: Record<string, string> = { Hosting: C.blue, Content: C.amber, Design: C.pink };

  return (
    <Stage>
      <Window page="Files" style={{ display: "flex" }}>
        <FilesPane active="Launch budget" />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "0 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0 0", fontSize: 11, color: C.faint }}>
            Files <I name="chevron" size={10} /> Launch budget
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0 0" }}>
            <span style={{ fontSize: 20 }}>💰</span>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Launch budget</h3>
            <span style={{ fontSize: 11, color: C.faint, padding: "2px 8px", borderRadius: 999, border: `1px solid ${C.line}` }}>Studio</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Btn style={{ height: 28, fontSize: 12 }}>Share</Btn>
            </span>
          </div>
          <ToolbarStrip />
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
            <span style={{ width: 44, height: 28, borderRadius: 6, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT.mono, fontSize: 11, color: C.soft }}>C7</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 11, color: C.faint }}>fx</span>
            <span style={{ flex: 1, height: 28, borderRadius: 6, border: `1px solid ${frame >= F_AT && frame < RESULT_AT ? C.accent : C.line}`, background: "#0b0c11", display: "flex", alignItems: "center", padding: "0 10px", fontFamily: FONT.mono, fontSize: 12, color: C.ink }}>
              {frame >= F_AT ? typed(FORMULA, frame, F_AT, 0.5) : ""}
              {frame >= F_AT && frame < RESULT_AT ? <Caret height={14} /> : null}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "34px 190px 140px 110px 90px 1fr", border: `1px solid ${C.line}`, borderBottom: 0, alignContent: "start", flex: 1 }}>
            <div style={{ ...cell, background: "#0b0c11" }} />
            {COLS.map((col) => (
              <div key={col} style={{ ...cell, background: "#0b0c11", color: C.faint, fontFamily: FONT.mono, fontSize: 11, justifyContent: "center" }}>
                {col}
              </div>
            ))}
            <div style={{ ...cell, background: "#0b0c11" }} />
            {[HEAD, ...ROWS].map((row, r) => (
              <RowCells key={r} r={r} row={row} frame={frame} cellAt={cellAt} cell={cell} catColor={catColor} />
            ))}
            <div style={{ ...cell, background: "#0b0c11", color: C.faint, fontFamily: FONT.mono, fontSize: 11, justifyContent: "center" }}>7</div>
            <div style={{ ...cell, fontWeight: 600 }}>{typed("Total", frame, F_AT - 14)}</div>
            <div style={cell} />
            <div style={{ ...cell, fontFamily: FONT.mono, justifyContent: "flex-end", color: frame >= RESULT_AT ? C.green : C.ink, background: frame >= RESULT_AT ? `color-mix(in oklab, ${C.green} 12%, transparent)` : frame >= F_AT ? `color-mix(in oklab, ${C.accent} 12%, transparent)` : "transparent", outline: frame >= F_AT ? `2px solid ${C.accent}` : "none", outlineOffset: -2 }}>
              {frame >= RESULT_AT ? "774.00" : frame >= F_AT ? typed(FORMULA, frame, F_AT, 0.5) : ""}
            </div>
            <div style={cell} />
            <div style={cell} />
            {[8, 9, 10, 11, 12].map((n) => (
              <EmptyRow key={n} n={n} cell={cell} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 10px", fontSize: 11, color: C.faint }}>
            <span style={{ padding: "3px 10px", borderRadius: 6, background: C.raised, color: C.ink }}>Launch budget</span>
            <span>+</span>
            <span style={{ marginLeft: "auto" }}>Selected: C7 · SUM 774.00</span>
          </div>
        </div>

        <div style={{ position: "absolute", right: 24, bottom: 52, width: 250, borderRadius: 12, border: `1px solid ${C.line2}`, background: C.panel, padding: 14, boxShadow: "0 30px 80px -30px rgba(0,0,0,0.9)", ...pop(frame, RESULT_AT + 18) }}>
          <p style={{ margin: 0, fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Card from this sheet</p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: C.soft }}>Launch budget · Total</p>
          <p style={{ margin: "2px 0 0", fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", color: C.ink, fontVariantNumeric: "tabular-nums" }}>774.00</p>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: C.faint, ...rise(frame, RESULT_AT + 34) }}>Dashboard card and phone widget</p>
        </div>
        <span style={{ position: "absolute", right: 24, top: 54, fontSize: 12, color: C.faint, opacity: fade(frame, 30, 12, RESULT_AT + 14) }}>Formulas, freeze panes, tabs</span>
      </Window>
      <Caption n="04" title="Sheets" note="Numbers next to the work, filled by you, the assistant or an agent" color={C.green} />
    </Stage>
  );
}

function RowCells({ r, row, frame, cellAt, cell, catColor }: { r: number; row: string[]; frame: number; cellAt: (r: number, c: number) => number; cell: React.CSSProperties; catColor: Record<string, string> }) {
  const head = r === 0;
  return (
    <>
      <div style={{ ...cell, background: "#0b0c11", color: C.faint, fontFamily: FONT.mono, fontSize: 11, justifyContent: "center" }}>{r + 1}</div>
      {row.map((value, c) => {
        const text = typed(value, frame, cellAt(r, c), 1.2);
        const done = text === value;
        return (
          <div key={c} style={{ ...cell, fontWeight: head ? 600 : 400, color: head ? C.soft : C.ink, fontFamily: c === 2 && !head ? FONT.mono : undefined, justifyContent: c === 2 && !head ? "flex-end" : "flex-start" }}>
            {!head && c === 1 && done ? (
              <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, background: `color-mix(in oklab, ${catColor[value] ?? C.soft} 18%, transparent)`, color: catColor[value] ?? C.soft }}>{value}</span>
            ) : !head && c === 3 && done ? (
              <span style={{ fontFamily: FONT.mono, fontSize: 11, color: value === "TRUE" ? C.green : C.faint }}>{value}</span>
            ) : (
              text
            )}
          </div>
        );
      })}
      <div style={cell} />
    </>
  );
}

function EmptyRow({ n, cell }: { n: number; cell: React.CSSProperties }) {
  return (
    <>
      <div style={{ ...cell, background: "#0b0c11", color: C.faint, fontFamily: FONT.mono, fontSize: 11, justifyContent: "center" }}>{n}</div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={cell} />
      ))}
    </>
  );
}
