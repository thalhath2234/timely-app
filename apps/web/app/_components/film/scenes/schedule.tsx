import { interpolate, useCurrentFrame } from "remotion";
import { EASE, fade, pop, rise } from "../anim";
import { Block, Btn, Caption, I, PageHeader, Segmented, Stage, Window } from "../kit";
import { C, FONT } from "../theme";

const DAYS = ["Sun 11", "Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16"];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16];
const ROW = 50;
const GRID_TOP = 30;
const LEFT = 40;

type Placed = { title: string; color: string; day: number; hour: number; len: number; at: number; movesTo?: { day: number; hour: number; at: number } };

const EVENTS = [
  { title: "Weekly planning", day: 1, hour: 9, len: 1 },
  { title: "Client review", day: 2, hour: 11, len: 1 },
  { title: "Lunch with Sam", day: 3, hour: 12, len: 1 },
  { title: "Workshop", day: 4, hour: 14, len: 2 },
  { title: "Farmers market", day: 0, hour: 10, len: 1 },
];

const TASKS: Placed[] = [
  { title: "Write the launch brief · 2h", color: C.violet, day: 1, hour: 10, len: 2, at: 18 },
  { title: "Build the launch budget · 1h", color: C.green, day: 2, hour: 9, len: 1, at: 34 },
  { title: "Design the homepage · 3h", color: C.amber, day: 3, hour: 13, len: 3, at: 50, movesTo: { day: 4, hour: 9, at: 104 } },
];

const WAITING = ["Send October invoices", "Pick three case studies", "Spanish lesson 12", "Deploy to production"];
const DENTIST_AT = 88;

/** 03 Auto-schedule: tasks fly from "Waiting for a slot" into free time; a new event moves one. */
export function ScheduleScene() {
  const frame = useCurrentFrame();
  const gridWidth = 1126 - 240 - LEFT - 20;
  const colWidth = gridWidth / 6;
  const cellLeft = (day: number) => LEFT + day * colWidth;
  const cellTop = (hour: number) => GRID_TOP + (hour - 9) * ROW;

  return (
    <Stage>
      <Window page="Calendar" style={{ display: "flex", flexDirection: "column" }}>
        <PageHeader
          title={
            <>
              Calendar
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500, color: C.soft, marginLeft: 6 }}>
                <I name="chevron" size={14} /> Oct 11 – 17, 2026 <I name="chevron" size={14} /> <span style={{ color: C.faint }}>Today</span>
              </span>
            </>
          }
          actions={
            <>
              <Btn icon="sparkle" style={{ borderColor: `color-mix(in oklab, ${C.accent} 40%, transparent)`, color: C.accent, background: `color-mix(in oklab, ${C.accent} 8%, transparent)` }}>
                Auto-schedule <span style={{ fontWeight: 400, color: C.faint }}>14</span>
              </Btn>
              <Btn primary icon="plus">
                Add
              </Btn>
              <Segmented options={["Day", "Week", "Month"]} active="Week" />
            </>
          }
          style={{ paddingBottom: 8 }}
        />
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ position: "relative", flex: 1 }}>
            {DAYS.map((day, i) => (
              <div key={day} style={{ position: "absolute", left: cellLeft(i), top: 6, width: colWidth, fontSize: 12, fontWeight: 600, color: i === 3 ? C.accent : C.soft }}>
                {day}
              </div>
            ))}
            {HOURS.map((hour) => (
              <div key={hour} style={{ position: "absolute", left: LEFT, right: 0, top: cellTop(hour), borderTop: `1px solid ${C.line}` }}>
                <span style={{ position: "absolute", left: -LEFT + 6, top: -7, fontSize: 10, color: C.faint, fontFamily: FONT.mono }}>{hour >= 12 ? `${hour === 12 ? 12 : hour - 12} PM` : `${hour} AM`}</span>
              </div>
            ))}
            {DAYS.map((day, i) => (
              <div key={day} style={{ position: "absolute", left: cellLeft(i), top: GRID_TOP, bottom: 0, borderLeft: `1px solid ${C.line}` }} />
            ))}
            <div style={{ position: "absolute", left: cellLeft(3), width: colWidth, top: cellTop(10.5), borderTop: `2px solid ${C.accent}` }} />

            {EVENTS.map((event) => (
              <Block key={event.title} color="#6f6f85" style={{ position: "absolute", left: cellLeft(event.day) + 4, width: colWidth - 8, top: cellTop(event.hour) + 2, height: event.len * ROW - 4, background: "#23242e", color: C.soft, fontSize: 12 }}>
                {event.title}
                <div style={{ fontSize: 10, color: C.faint, fontWeight: 400 }}>
                  {event.hour > 12 ? event.hour - 12 : event.hour}:00 – {event.hour + event.len > 12 ? event.hour + event.len - 12 : event.hour + event.len}:00
                </div>
              </Block>
            ))}

            {frame >= DENTIST_AT ? (
              <Block color="#6f6f85" style={{ position: "absolute", left: cellLeft(3) + 4, width: colWidth - 8, top: cellTop(14) + 2, height: ROW - 4, background: "#23242e", color: C.soft, fontSize: 12, ...pop(frame, DENTIST_AT) }}>
                Dentist <span style={{ color: C.faint, fontWeight: 400 }}>· new</span>
              </Block>
            ) : null}

            {TASKS.map((task, index) => {
              if (frame < task.at) return null;
              const moving = task.movesTo && frame >= task.movesTo.at;
              const p = moving ? interpolate(frame, [task.movesTo!.at, task.movesTo!.at + 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }) : 0;
              const left = cellLeft(task.day) + (moving ? (cellLeft(task.movesTo!.day) - cellLeft(task.day)) * p : 0) + 4;
              const top = cellTop(task.hour) + (moving ? (cellTop(task.movesTo!.hour) - cellTop(task.hour)) * p : 0) + 2;
              const enter = interpolate(frame, [task.at, task.at + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
              // Starts at its row in the right-hand list and lands in the grid.
              const fromLeft = gridWidth + 60;
              const fromTop = 40 + index * 64;
              return (
                <Block key={task.title} color={task.color} style={{ position: "absolute", left: left + (fromLeft - left) * (1 - enter), top: top + (fromTop - top) * (1 - enter), width: colWidth - 8, height: task.len * ROW - 4, fontSize: 12, opacity: 0.5 + enter * 0.5, boxShadow: enter < 1 || (moving && p < 1) ? "0 20px 50px -10px rgba(0,0,0,0.8)" : "none", zIndex: 3 }}>
                  {task.title}
                  {moving ? <div style={{ fontSize: 10, color: C.soft, marginTop: 3, fontWeight: 400 }}>moved from Wed</div> : null}
                </Block>
              );
            })}
          </div>

          <div style={{ width: 240, flexShrink: 0, borderLeft: `1px solid ${C.line}`, padding: "10px 14px" }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <I name="timer" size={14} color={C.soft} /> Waiting for a slot <span style={{ marginLeft: "auto", color: C.faint, fontWeight: 400 }}>{14 - TASKS.filter((t) => frame >= t.at).length}</span>
            </p>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {TASKS.map((task) => (
                <div key={task.title} style={{ height: 56, borderRadius: 8, border: `1px dashed ${C.line2}`, padding: "8px 10px", fontSize: 12, opacity: frame < task.at ? 1 : 0.3, color: frame < task.at ? C.ink : C.faint }}>
                  {frame < task.at ? task.title : "placed"}
                  <div style={{ fontSize: 10, color: C.faint, marginTop: 3 }}>{frame < task.at ? "due Oct 16 · Schedule this" : ""}</div>
                </div>
              ))}
              {WAITING.map((title) => (
                <div key={title} style={{ height: 56, borderRadius: 8, border: `1px solid ${C.line}`, padding: "8px 10px", fontSize: 12, color: C.soft }}>
                  {title}
                  <div style={{ fontSize: 10, color: C.faint, marginTop: 3 }}>Schedule this</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, borderRadius: 10, padding: "10px 12px", background: `color-mix(in oklab, ${C.green} 12%, transparent)`, border: `1px solid color-mix(in oklab, ${C.green} 30%, transparent)`, fontSize: 12, color: C.soft, ...rise(frame, 118) }}>
              <strong style={{ color: C.ink }}>Auto-schedule ran</strong>
              <br />3 placed, 1 moved. Pins stayed.
            </div>
          </div>
        </div>
      </Window>
      <Caption n="03" title="Auto-schedule" note="Work lands in free time inside your hours and gets out of the way of meetings" color={C.amber} />
      <span style={{ position: "absolute", right: 50, bottom: 18, fontSize: 13, color: C.faint, opacity: fade(frame, 20) }}>Working hours 9–5 · pins stay put</span>
    </Stage>
  );
}
