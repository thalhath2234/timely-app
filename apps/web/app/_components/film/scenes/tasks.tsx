import { interpolate, useCurrentFrame } from "remotion";
import { EASE, fade, pop, rise } from "../anim";
import { Btn, Caption, PageHeader, Pill, Pointer, Segmented, Stage, Window } from "../kit";
import { C } from "../theme";

type Card = { title: string; project: string; color: string; due: string };
const STUDIO: Card[] = [
  { title: "Fix build on Windows", project: "Release v0.4", color: C.red, due: "Deadline: Oct 13" },
  { title: "Write the launch brief", project: "Website refresh", color: C.violet, due: "Deadline: Oct 13" },
  { title: "Send October invoices", project: "Studio", color: C.violet, due: "Deadline: Oct 14" },
  { title: "Pick three case studies", project: "Website refresh", color: C.violet, due: "Deadline: Oct 14" },
];
const PERSONAL: Card[] = [
  { title: "Book the moving van", project: "Move to the new flat", color: C.green, due: "Deadline: Oct 14" },
  { title: "Spanish lesson 12", project: "Learn Spanish", color: C.amber, due: "Deadline: Oct 17" },
  { title: "Pack the bookshelf", project: "Move to the new flat", color: C.green, due: "Deadline: Oct 25" },
];

const DRAG_START = 24;
const DRAG_END = 64;
const GANTT = 94;

const GANTT_ROWS = [
  { title: "Book the moving van", sub: "Personal · Move to the new flat", color: C.green, from: 0, len: 2 },
  { title: "Send October invoices", sub: "Studio", color: C.violet, from: 1, len: 2 },
  { title: "Write the launch brief", sub: "Studio · Website refresh", color: C.violet, from: 1, len: 1 },
  { title: "Design the homepage", sub: "Studio · Website refresh", color: C.violet, from: 2, len: 3 },
  { title: "Spanish lesson 12", sub: "Personal · Learn Spanish", color: C.amber, from: 4, len: 3 },
  { title: "Deploy to production", sub: "Studio · Website refresh", color: C.violet, from: 6, len: 4 },
];

/** 02 Workspaces and projects: the board grouped by workspace, a drag, then the Gantt view. */
export function TasksScene() {
  const frame = useCurrentFrame();
  const drag = interpolate(frame, [DRAG_START, DRAG_END], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const lifted = frame > DRAG_START - 6 && frame < DRAG_END + 4;
  const gantt = frame >= GANTT;
  // The dragged card moves from the Studio column into Personal.
  const px = 300 + drag * 300;
  const py = 300 - drag * 60;

  return (
    <Stage>
      <Window page="Tasks">
        <PageHeader
          title="Projects & Tasks"
          subtitle="15 Tasks · 4 Projects"
          actions={
            <>
              <Btn>Hide options</Btn>
              <Btn primary icon="plus">
                New task
              </Btn>
            </>
          }
        />
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 24px", fontSize: 12, color: C.faint }}>
          <span style={{ color: C.soft }}>Task List</span>
          <span>My Deadlines</span>
          <span>Overview</span>
          <span>Project Timelines</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 24px 0", fontSize: 12, color: C.faint }}>
          <span style={{ padding: "4px 10px", borderRadius: 8, border: `1px solid ${C.line2}`, color: C.soft }}>Group by: Workspace › Project › Stage</span>
          <Segmented options={["List", "Kanban", "Gantt"]} active={gantt ? "Gantt" : "Kanban"} style={{ fontSize: 12 }} />
          <span style={{ marginLeft: "auto" }}>Status: All · Workspace: All</span>
        </div>

        {!gantt ? (
          <div style={{ margin: "14px 24px 0", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, opacity: fade(frame, 0, 1, GANTT - 8) }}>
            {[
              { name: "Studio", color: C.violet, cards: STUDIO },
              { name: "Personal", color: C.green, cards: PERSONAL },
            ].map((column, ci) => (
              <div key={column.name} style={{ borderRadius: 12, background: "#0b0c11", border: `1px solid ${C.line}`, padding: 10, minHeight: 440 }}>
                <p style={{ margin: "2px 6px 10px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: column.color }} />
                  {column.name}
                  <span style={{ marginLeft: "auto", color: C.faint, fontWeight: 400 }}>{column.cards.length + (ci === 1 && frame >= DRAG_END ? 1 : 0) - (ci === 0 && frame >= DRAG_END ? 1 : 0)}</span>
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {ci === 1 && frame >= DRAG_END ? <div style={{ height: 70 }} /> : null}
                  {column.cards.map((card, i) =>
                    ci === 0 && i === 0 && frame >= DRAG_START - 6 ? (
                      <div key={card.title} style={{ height: 70, borderRadius: 10, border: `1px dashed ${C.line2}`, opacity: frame >= DRAG_END ? 0 : 0.6 }} />
                    ) : (
                      <TaskCard key={card.title} card={card} />
                    ),
                  )}
                </div>
              </div>
            ))}
            <div style={{ borderRadius: 12, border: `1px dashed ${C.line}`, padding: 10, minHeight: 440, color: C.faint, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>+ Workspace</div>
          </div>
        ) : (
          <div style={{ margin: "14px 24px 0", ...rise(frame, GANTT) }}>
            <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", fontSize: 11, color: C.faint, borderBottom: `1px solid ${C.line}`, paddingBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <span>Task</span>
              <span>Oct 12 – Oct 25</span>
            </div>
            {GANTT_ROWS.map((row, i) => (
              <div key={row.title} style={{ display: "grid", gridTemplateColumns: "280px 1fr", alignItems: "center", height: 54, borderBottom: `1px solid ${C.line}` }}>
                <span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: row.color }} />
                    {row.title}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: C.faint, marginLeft: 15 }}>{row.sub}</span>
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", height: 14 }}>
                  <div
                    style={{
                      gridColumn: `${row.from + 1} / span ${row.len}`,
                      borderRadius: 99,
                      background: row.color,
                      transformOrigin: "left",
                      scale: `${interpolate(frame, [GANTT + 6 + i * 4, GANTT + 24 + i * 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE })} 1`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {lifted ? (
          <div style={{ position: "absolute", left: px - 150, top: py - 20, width: 300, rotate: `${drag * (1 - drag) * 6}deg`, zIndex: 4, ...pop(frame, DRAG_START - 6, 6) }}>
            <TaskCard card={STUDIO[0]} shadow />
          </div>
        ) : null}
        {!gantt ? <Pointer x={px + 60} y={py + 10} pressed={lifted} opacity={fade(frame, 4, 8, GANTT - 10)} /> : null}
        <span style={{ position: "absolute", left: 24, bottom: 14, fontSize: 11, color: C.faint }}>All local changes synced · Showing 15 tasks</span>
      </Window>
      <Caption n="02" title="Workspaces and projects" note="Stages, labels, custom fields; list, board and Gantt" color={C.red} />
    </Stage>
  );
}

function TaskCard({ card, shadow = false }: { card: Card; shadow?: boolean }) {
  return (
    <div style={{ borderRadius: 10, border: `1px solid ${C.line}`, background: C.panel, padding: "10px 12px", boxShadow: shadow ? "0 30px 60px -20px rgba(0,0,0,0.9)" : "none" }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{card.title}</div>
      <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
        <Pill color={card.color}>{card.project}</Pill>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: C.faint }}>{card.due}</div>
    </div>
  );
}
