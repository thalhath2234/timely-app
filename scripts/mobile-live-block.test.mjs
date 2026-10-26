import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { boardExamples, drawBoard } from "../packages/contract/src/genuiBoard.ts";
import { escapeHtml, liveBlockHtml } from "../apps/mobile/components/editor/liveBlockHtml.ts";

// The phone draws a doc's live blocks as HTML for its editor page; these
// check that markup against the shared programs and data.
const ctx = { now: new Date("2026-10-28T12:00:00Z"), timeZone: "UTC" };
const projects = [{ id: "p1", title: "Client work", workspaceId: "ws1" }];
const task = (id, name, extra = {}) => ({
  id, name, kind: "work", projectId: "p1", project: projects[0], workspaceId: "ws1", deadline: null, completedAt: null,
  createdAt: "2026-10-01", updatedAt: "2026-10-01T09:00:00Z", duration: 30, actualMinutes: 0, labels: [], blocks: [], ...extra,
});
const data = {
  workspaces: [{ id: "ws1", name: "Work", status: [] }],
  projects,
  tasks: [
    task("t1", "Send <b>invoice</b>", { deadline: "2026-10-26" }),
    task("t2", "Review proposal", { deadline: "2026-10-30" }),
    task("t3", "Ship release", { completedAt: "2026-10-27T15:00:00Z", actualMinutes: 90 }),
  ],
};
const lookup = (id) => {
  const found = data.tasks.find((entry) => entry.id === id);
  return found && { title: found.name, done: Boolean(found.completedAt), late: id === "t1" };
};
const draw = (program) => liveBlockHtml(drawBoard(program, data, ctx), lookup);

describe("phone live block HTML", () => {
  test("every example program draws", () => {
    for (const { program } of boardExamples()) {
      const html = draw(program);
      assert.match(html, /^<div class="lv-panel">/, program);
      assert.ok(!html.includes("[object Object]"), program);
      assert.ok(!html.includes("undefined"), program);
    }
  });

  test("task rows tick, open and show their live state", () => {
    const html = draw(`root = Panel("Client work", [list])
list = List(@Each(@Data({source: "tasks", project: "Client work", state: "all", sort: "deadline"}).rows, "row", TaskRow(row.id, row.title, row.day, row.note)), "Nothing here")`);
    assert.match(html, /data-live-tick="t1" data-done="0"/);
    assert.match(html, /data-live-open="timely:\/\/task\/t1"/);
    // A late task's row is marked; a done one is struck through and says so.
    assert.match(html, /<div class="lv-row is-warning">/);
    assert.match(html, /class="lv-check is-done" role="checkbox" aria-checked="true"/);
    assert.match(html, /<span class="lv-title is-done">Ship release<\/span>/);
    assert.match(html, /<span class="lv-meta">Done<\/span>/);
  });

  test("text from the data or the program is escaped", () => {
    const html = draw(`root = Panel("A <script>", [list, note])
list = List(@Each(@Data({source: "tasks", project: "Client work"}).rows, "row", TaskRow(row.id, row.title)))
note = Text("<img src=x onerror=alert(1)>")`);
    assert.ok(!/<b>|<script|<img/.test(html), html);
    assert.match(html, /Send &lt;b&gt;invoice&lt;\/b&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal(escapeHtml(`"'&`), "&quot;&#39;&amp;");
  });

  test("a task the app doesn't know can't be ticked", () => {
    const html = liveBlockHtml(drawBoard(`root = Panel("x", [List([TaskRow("gone", "Old task")])])`, data, ctx), () => undefined);
    assert.match(html, /<button type="button" class="lv-check" role="checkbox" aria-checked="false" aria-label="Complete Old task" disabled>/);
    assert.ok(!html.includes("data-live-open"));
  });

  test("stats, charts, shares, a day strip, columns and links", () => {
    const html = draw(`root = Panel("Week", [nums, chart, shares, day, cols, Text("Notes")])
nums = Stats([Stat("Done", "18/22"), Stat("On time", "82%"), Stat("Focus", "9h"), Stat("Late", "2")])
chart = BarChart("Focus by day", ["Mon", "Tue", "Wed"], [2, 5, 3], "h")
shares = Card("Projects", [ShareRow("Client work", "5 h", 100, "indigo"), InfoRow("Late", "2", "This week", "warning"), EventRow("10:00", "Gym", "1 h", "teal")], "3", Open("Open Today", "today"))
day = DayStrip("08:00", "20:00", [Slot("09:00", "10:30", "event", "Standup", "teal"), Slot("13:00", "15:00", "free")])
cols = Columns([Card("Left", [InfoRow("A")]), Card("Right", [InfoRow("B")], null, Open("Open doc", "doc", "doc_1"))])`);
    // Four stats sit two by two, the second row bordered on top.
    assert.match(html, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(html, /<div class="lv-stat-value">18<span class="lv-stat-total">\/22<\/span><\/div>/);
    assert.match(html, /<div class="lv-stat is-top">/);
    // The tallest bar stands out; bars carry their value for screen readers.
    assert.match(html, /aria-label="Tue: 5 h"><span class="lv-bar-text">5<\/span><span class="lv-bar is-high" style="height:64px">/);
    assert.match(html, /<span style="width:100%;background:#[0-9a-f]{6}">/i);
    assert.match(html, /<div class="lv-row is-warning"><span class="lv-body"><span class="lv-line"><span class="lv-title lv-label">Late<\/span><span class="lv-value">2<\/span>/);
    assert.match(html, /<span class="lv-event-bar" style="background:#[0-9a-f]{6}">/i);
    assert.match(html, /class="lv-slot" style="left:8\.33/);
    assert.match(html, /class="lv-slot is-free"/);
    assert.match(html, /<span class="is-start" style="left:0%">08<\/span>/);
    assert.match(html, /<span class="is-end" style="left:100%">20<\/span>/);
    // In Columns a card's title is a heading, not an eyebrow.
    assert.match(html, /<span class="lv-head-title">Left<\/span>/);
    assert.match(html, /<span class="lv-eyebrow">PROJECTS<\/span><span class="lv-head-meta">3<\/span>/);
    assert.match(html, /data-live-open="\/today">Open Today/);
    assert.match(html, /data-live-open="timely:\/\/doc\/doc_1">Open doc/);
    assert.match(html, /<p class="lv-text">Notes<\/p>/);
  });

  test("an empty list says so", () => {
    const html = draw(`root = Panel("x", [List(@Each(@Data({source: "tasks", project: "Garden"}).rows, "row", TaskRow(row.id, row.title)), "Nothing overdue")])`);
    assert.match(html, /<p class="lv-empty">Nothing overdue<\/p>/);
  });

  test("a program that can't be drawn gives no HTML", () => {
    assert.equal(liveBlockHtml(null, lookup), "");
  });
});

