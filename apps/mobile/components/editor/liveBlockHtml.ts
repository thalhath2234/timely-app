import { chartNumber, genuiColorHex, genuiNodes, replyBlocks, type GenuiNode } from "@timely/contract/genui";

/*
 * A live block drawn for the phone's doc editor. The editor is a web page
 * (editorHtml.ts) and the openui renderer draws React Native views, so the
 * app works out the block with drawBoard and hands the page this HTML: the
 * phone kit (components/genui/kit.tsx) as markup, with the same rows, stats,
 * bars and strip, styled by the editor's .lv-* rules. Every text is escaped;
 * ticks and links are buttons with data attributes the page passes back to
 * the app, which does the tick or the navigation itself.
 */

/** A task as the block shows it now, from the app's own task lists. */
export type LiveTask = { title: string; done: boolean; late: boolean };

type Lookup = (taskId: string) => LiveTask | undefined;
type Place = "top" | "column";

const TIMED = new Set(["TaskRow", "EventRow"]);

const SCREENS: Record<string, string> = {
  today: "/today",
  calendar: "/calendar",
  tasks: "/tasks",
  inbox: "/inbox",
  dashboard: "/dashboard",
};

const CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const WARNING = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const color = (name: unknown) => genuiColorHex(typeof name === "string" ? name : undefined) ?? "var(--lv-primary)";

function clock(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

/** Rows divided by hairlines, sharing a time column when any of them has a time. */
function rows(value: unknown, tasks: Lookup) {
  const nodes = genuiNodes(value);
  const timed = nodes.some((row) => TIMED.has(row.typeName) && text(row.props.time));
  return nodes.map((row) => `<div class="lv-item">${node(row, tasks, "top", timed)}</div>`).join("");
}

function row(parts: { time?: string; timed: boolean; lead?: string; body: string; meta?: string; tone?: string }) {
  const tone = parts.tone === "warning" ? " is-warning" : parts.tone === "success" ? " is-success" : "";
  const time = parts.timed || parts.time ? `<span class="lv-time">${escapeHtml(parts.time ?? "")}</span>` : "";
  const lead = parts.lead !== undefined ? `<span class="lv-lead">${parts.lead}</span>` : "";
  const meta = parts.meta ? `<span class="lv-meta">${escapeHtml(parts.meta)}</span>` : "";
  return `<div class="lv-row${tone}">${time}${lead}<span class="lv-body">${parts.body}${meta}</span></div>`;
}

function open(props: Record<string, unknown>) {
  const target = text(props.target);
  const id = text(props.id);
  const href = SCREENS[target] ?? (id ? `timely://${target}/${encodeURIComponent(id)}` : "");
  if (!href) return "";
  return `<button type="button" class="lv-open" data-live-open="${escapeHtml(href)}">${escapeHtml(props.label)}${CHEVRON}</button>`;
}

function node(item: GenuiNode, tasks: Lookup, place: Place = "top", timed = false): string {
  const props = item.props;
  switch (item.typeName) {
    case "Panel":
      return `<div class="lv-panel">${replyBlocks(props.blocks)
        .map((block) => `<div class="lv-sec">${node(block, tasks)}</div>`)
        .join("")}</div>`;
    case "List": {
      const body = genuiNodes(props.rows).length
        ? rows(props.rows, tasks)
        : `<p class="lv-empty">${escapeHtml(text(props.empty) || "Nothing here yet")}</p>`;
      const foot = props.open ? `<div class="lv-foot">${node(props.open as GenuiNode, tasks)}</div>` : "";
      return body + foot;
    }
    case "Card": {
      const title = text(props.title);
      const head =
        `<div class="lv-head"><span class="${place === "column" ? "lv-head-title" : "lv-eyebrow"}">${escapeHtml(place === "column" ? title : title.toUpperCase())}</span>` +
        (text(props.meta) ? `<span class="lv-head-meta">${escapeHtml(props.meta)}</span>` : "") +
        "</div>";
      const foot = props.open ? `<div class="lv-foot">${node(props.open as GenuiNode, tasks)}</div>` : "";
      return `<div class="lv-card" aria-label="${escapeHtml(title)}">${head}${rows(props.rows, tasks)}${foot}</div>`;
    }
    case "Columns":
      return genuiNodes(props.cards)
        .map((card) => `<div class="lv-item">${node(card, tasks, "column")}</div>`)
        .join("");
    case "Stats": {
      const items = genuiNodes(props.items);
      if (!items.length) return "";
      const columns = items.length === 4 ? 2 : Math.min(items.length, 3);
      return `<div class="lv-stats" style="grid-template-columns:repeat(${columns},minmax(0,1fr))">${items
        .map((stat, index) => {
          const edges = `${index % columns > 0 ? " is-left" : ""}${index >= columns ? " is-top" : ""}`;
          return `<div class="lv-stat${edges}">${node(stat, tasks)}</div>`;
        })
        .join("")}</div>`;
    }
    case "Stat": {
      // "18/22" reads as 18 out of 22: the total sits small and muted.
      const [main, ...rest] = text(props.value).split("/");
      const total = rest.join("/");
      return (
        `<div class="lv-stat-value">${escapeHtml(main)}${total ? `<span class="lv-stat-total">/${escapeHtml(total)}</span>` : ""}</div>` +
        `<div class="lv-stat-label">${escapeHtml(props.label)}</div>` +
        (text(props.hint) ? `<div class="lv-stat-hint">${escapeHtml(props.hint)}</div>` : "")
      );
    }
    case "TaskRow": {
      const id = text(props.taskId);
      const task = tasks(id);
      const title = task?.title || text(props.title);
      const done = Boolean(task?.done);
      const check =
        `<button type="button" class="lv-check${done ? " is-done" : ""}" role="checkbox" aria-checked="${done}"` +
        ` aria-label="${escapeHtml(`${done ? "Reopen" : "Complete"} ${title}`)}"` +
        (task ? ` data-live-tick="${escapeHtml(id)}" data-done="${done ? 1 : 0}"` : " disabled") +
        `>${CHECK}</button>`;
      const name = task
        ? `<button type="button" class="lv-title-btn" data-live-open="${escapeHtml(`timely://task/${encodeURIComponent(id)}`)}"><span class="lv-title${done ? " is-done" : ""}">${escapeHtml(title)}</span></button>`
        : `<span class="lv-title">${escapeHtml(title)}</span>`;
      return row({
        time: text(props.time),
        timed,
        lead: check,
        body: name,
        meta: done ? "Done" : text(props.note),
        tone: task?.late && !done ? "warning" : undefined,
      });
    }
    case "EventRow":
      return row({
        time: text(props.time),
        timed,
        lead: `<span class="lv-event-bar" style="background:${escapeHtml(color(props.color))}"></span>`,
        body: `<span class="lv-title">${escapeHtml(props.title)}</span>`,
        meta: text(props.length),
      });
    case "InfoRow": {
      const value = text(props.value) ? `<span class="lv-value">${escapeHtml(props.value)}</span>` : "";
      const note = text(props.note) ? `<span class="lv-meta lv-note">${escapeHtml(props.note)}</span>` : "";
      return row({
        timed: false,
        body: `<span class="lv-line"><span class="lv-title lv-label">${escapeHtml(props.label)}</span>${value}</span>${note}`,
        tone: text(props.tone),
      });
    }
    case "ShareRow": {
      const hex = escapeHtml(color(props.color));
      const share = Math.max(0, Math.min(100, Number(props.share) || 0));
      return (
        `<div class="lv-share"><span class="lv-line"><span class="lv-dot" style="background:${hex}"></span>` +
        `<span class="lv-title lv-label">${escapeHtml(props.label)}</span><span class="lv-value">${escapeHtml(props.value)}</span></span>` +
        `<span class="lv-fill"><span style="width:${share}%;background:${hex}"></span></span></div>`
      );
    }
    case "BarChart": {
      const values = (Array.isArray(props.values) ? props.values : []).slice(0, 12).map((value) => Number(value) || 0);
      const labels = Array.isArray(props.labels) ? props.labels.map(text) : [];
      const max = Math.max(...values, 0) || 1;
      const unit = text(props.unit) ? ` ${text(props.unit)}` : "";
      const highlight = text(props.highlight);
      if (!values.length) return "";
      const bars = values
        .map((value, index) => {
          const label = labels[index] ?? "";
          const high = highlight ? label === highlight : value === max;
          const height = Math.max(2, Math.round((value / max) * 64));
          return (
            `<div class="lv-bar-col" role="img" aria-label="${escapeHtml(`${label}: ${value}${unit}`)}">` +
            `<span class="lv-bar-text">${escapeHtml(chartNumber(value))}</span>` +
            `<span class="lv-bar${high ? " is-high" : ""}" style="height:${height}px"></span>` +
            `<span class="lv-bar-text lv-bar-label">${escapeHtml(label)}</span></div>`
          );
        })
        .join("");
      return `<div class="lv-chart"><div class="lv-chart-title">${escapeHtml(props.title)}</div><div class="lv-bars">${bars}</div></div>`;
    }
    case "DayStrip": {
      const from = clock(text(props.start));
      const to = clock(text(props.end));
      if (!(to > from)) return "";
      const span = to - from;
      const at = (minutes: number) => ((minutes - from) / span) * 100;
      const slots = genuiNodes(props.slots)
        .map((slot) => {
          const p = slot.props;
          const start = Math.max(clock(text(p.from)), from);
          const end = Math.min(clock(text(p.to)), to);
          if (!(end > start)) return "";
          const free = p.kind === "free";
          const hex = genuiColorHex(text(p.color) || undefined);
          const plain = p.kind === "task" && !hex;
          const label = free ? text(p.label) || "Free" : text(p.label);
          const kind = free ? " is-free" : plain ? " is-task" : "";
          const fill = free || plain ? "" : `;background:${escapeHtml(hex ?? genuiColorHex("indigo"))}`;
          return `<span class="lv-slot${kind}" style="left:${at(start)}%;width:calc(${at(end) - at(start)}% - 3px)${fill}">${label ? `<span>${escapeHtml(label)}</span>` : ""}</span>`;
        })
        .join("");
      const ticks: string[] = [];
      for (let tick = Math.ceil(from / 120) * 120; tick <= to; tick += 120) {
        // Ticks at the strip's ends sit inside it instead of on its edge.
        const edge = at(tick) < 4 ? ' class="is-start"' : at(tick) > 96 ? ' class="is-end"' : "";
        ticks.push(`<span${edge} style="left:${at(tick)}%">${String(Math.floor(tick / 60)).padStart(2, "0")}</span>`);
      }
      const summary = genuiNodes(props.slots)
        .map((slot) => `${text(slot.props.from)}–${text(slot.props.to)} ${slot.props.kind === "free" ? "free" : text(slot.props.label) || text(slot.props.kind)}`)
        .join(", ");
      return `<div class="lv-strip-wrap"><div class="lv-strip" role="img" aria-label="${escapeHtml(summary)}">${slots}</div><div class="lv-ticks">${ticks.join("")}</div></div>`;
    }
    case "Text":
      return `<p class="lv-text">${escapeHtml(props.text)}</p>`;
    case "Open":
      return open(props);
    default:
      return "";
  }
}

/**
 * The block's HTML for the editor page; empty when the program could not be
 * drawn. problem says what the program names that the sheets don't have
 * (cellsProblems), over the drawing.
 */
export function liveBlockHtml(root: GenuiNode | null, tasks: Lookup, problem = ""): string {
  if (!root) return "";
  const note = problem ? `<p class="lv-problem" role="status">${WARNING}<span>${escapeHtml(problem)}</span></p>` : "";
  return note + node(root, tasks);
}
