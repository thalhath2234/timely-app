import {
  axisMoney,
  formatMoney,
  isBotId,
  PRICE_BLOCK,
  priceChartGeometry,
  priceHistory,
  signedPct,
  type BotDetail,
} from "@timely/contract/bots";
import { findChecklistItem, type DocChecklistItem } from "@timely/contract/docChecklist";
import { chartNumber, genuiColorHex, genuiNodes, replyBlocks, type GenuiNode } from "@timely/contract/genui";

/*
 * A live block drawn for the phone's doc editor. The editor is a web page
 * (editorHtml.ts) and the openui renderer draws React Native views, so the
 * app works out the block with drawBoard and hands the page this HTML: the
 * phone kit (components/genui/kit.tsx) as markup, with the same rows, stats,
 * bars and strip, styled by the editor's .lv-* rules. Every text is escaped;
 * ticks (a task's, or an item on a doc's checklist) and links are buttons
 * with data attributes the page passes back to the app, which does the tick
 * or the navigation itself.
 */

/** A task as the block shows it now, from the app's own task lists. */
export type LiveTask = { title: string; done: boolean; late: boolean };

/** A bot as a price block reads it: an id that is no bot id is never fetched. */
export type LiveBot =
  | { state: "invalid" }
  | { state: "loading" }
  | { state: "gone" }
  | { state: "failed" }
  | { state: "ok"; detail: BotDetail };

/** What the block's rows show as it is now, from the app's own lists. */
export type Live = {
  task: (taskId: string) => LiveTask | undefined;
  /** A doc's checklist items; undefined when the app doesn't have the doc. */
  checklist: (docId: string) => DocChecklistItem[] | undefined;
  /** A bot for a PriceHistory block; left out, the block draws nothing yet. */
  bot?: (botId: string) => LiveBot;
  /** The price chart's width in px: the editor's content width less the block's padding. */
  chartWidth?: number;
};
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
function rows(value: unknown, live: Live) {
  const nodes = genuiNodes(value);
  const timed = nodes.some((row) => TIMED.has(row.typeName) && text(row.props.time));
  return nodes.map((row) => `<div class="lv-item">${node(row, live, "top", timed)}</div>`).join("");
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

/** The phone chart's box (components/bots/PriceChart.tsx). */
const PRICE_BOX = { height: 130, left: 40, right: 8, top: 8, bottom: 20 };

/** The price chart as an inline SVG, laid out by the contract as the phone's chart is drawn. */
function priceSvg(points: [number, number][], threshold: number | null, currency: string, width: number): string {
  const geometry = priceChartGeometry(points, threshold, { width, ...PRICE_BOX });
  if (!geometry) return `<p class="lv-price-empty">${escapeHtml(PRICE_BLOCK.empty)}</p>`;
  const { height, left, right } = PRICE_BOX;
  const n = (value: number) => value.toFixed(1);
  const end = width - right;
  const first = points[0][1];
  const lastValue = points[points.length - 1][1];
  const label = `Price over the last ${points.length} readings, from ${formatMoney(first, currency)} to ${formatMoney(lastValue, currency)}; lowest ${formatMoney(geometry.low.value, currency)}`;
  const parts: string[] = [];
  for (const tick of geometry.grid) {
    parts.push(`<line class="lv-price-grid" x1="${left}" x2="${n(end)}" y1="${n(tick.y)}" y2="${n(tick.y)}"/>`);
    parts.push(`<text class="lv-price-axis" x="${left - 6}" y="${n(tick.y + 3.5)}" text-anchor="end">${escapeHtml(axisMoney(tick.value, currency))}</text>`);
  }
  parts.push(`<path class="lv-price-area" d="${geometry.area}"/>`);
  if (threshold != null && geometry.thresholdY != null) {
    const words = `Your line ${formatMoney(threshold, currency)}`;
    const y = geometry.thresholdY;
    parts.push(`<line class="lv-price-threshold" x1="${left}" x2="${n(end)}" y1="${n(y)}" y2="${n(y)}"/>`);
    // A card-coloured backing keeps the label readable over the fill.
    parts.push(`<rect class="lv-price-backing" x="${left + 1}" y="${n(y - 17)}" width="${Math.round(words.length * 6.2) + 6}" height="15" rx="4"/>`);
    parts.push(`<text class="lv-price-threshold-label" x="${left + 4}" y="${n(y - 5)}">${escapeHtml(words)}</text>`);
  }
  parts.push(`<path class="lv-price-line" d="${geometry.line}"/>`);
  const { low, last } = geometry;
  if (low.x !== last.x) {
    // The low point's label goes on whichever side has room.
    const right = low.x < end - 64;
    parts.push(`<circle class="lv-price-dot" cx="${n(low.x)}" cy="${n(low.y)}" r="3.5"/>`);
    parts.push(
      `<text class="lv-price-low" x="${n(right ? low.x + 6 : low.x - 6)}" y="${n(low.y - 6)}" text-anchor="${right ? "start" : "end"}">${escapeHtml(formatMoney(low.value, currency))}</text>`,
    );
  }
  parts.push(`<circle class="lv-price-dot" cx="${n(last.x)}" cy="${n(last.y)}" r="3.5"/>`);
  geometry.xLabels.forEach((tick) => {
    parts.push(`<text class="lv-price-axis" x="${n(tick.x)}" y="${height - 4}" text-anchor="${tick.anchor}">${escapeHtml(tick.label)}</text>`);
  });
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="lv-price-chart" role="img" aria-label="${escapeHtml(label)}">${parts.join("")}</svg>`;
}

/** A bot's price history, laid out as the bot sheet's price card (components/bots/PriceBody.tsx). */
function priceBlock(props: Record<string, unknown>, live: Live): string {
  const id = props.bot;
  const note = (title: string, hint?: string) =>
    `<div class="lv-empty lv-price-note"><span class="lv-price-note-title">${escapeHtml(title)}</span>${hint ? `<span>${escapeHtml(hint)}</span>` : ""}</div>`;
  if (!isBotId(id)) return note(PRICE_BLOCK.failed);
  const bot = live.bot?.(id) ?? { state: "loading" };
  if (bot.state === "loading") return "";
  if (bot.state === "gone") return note(PRICE_BLOCK.deleted, PRICE_BLOCK.deletedHint);
  if (bot.state !== "ok") return note(PRICE_BLOCK.failed);
  const model = priceHistory(bot.detail, typeof props.watch === "string" ? props.watch : undefined);
  if (!model) return note(PRICE_BLOCK.noPrice);
  const { currency } = model;
  const meta = [model.multiple ? model.label : "", model.paused ? "Paused" : ""].filter(Boolean).join(" · ");
  const low = model.low != null ? `<span class="lv-price-lowest">${escapeHtml(`30-day low ${formatMoney(model.low, currency)}`)}</span>` : "";
  const change =
    model.changePct != null
      ? ` · <span class="lv-price-change${model.good ? " is-good" : ""}">${escapeHtml(signedPct(model.changePct))}</span> since ${escapeHtml(model.since)}`
      : "";
  const head =
    (meta ? `<p class="lv-price-meta">${escapeHtml(meta)}</p>` : "") +
    `<div class="lv-price-top"><span class="lv-price-value">${escapeHtml(model.value != null ? formatMoney(model.value, currency) : "—")}</span>${low}</div>` +
    `<p class="lv-price-under">${escapeHtml(model.value == null ? "Not read yet" : (model.under ?? "Now"))}${change}</p>`;
  const width = Math.max(120, Math.floor(live.chartWidth ?? 300));
  const href = `timely://bot/${encodeURIComponent(id)}`;
  const name = bot.detail.name;
  return (
    `<div class="lv-price" role="group" aria-label="${escapeHtml(`${name}: price`)}">${head}${priceSvg(model.points, model.threshold, currency, width)}</div>` +
    `<div class="lv-foot"><button type="button" class="lv-open" data-live-open="${escapeHtml(href)}" aria-label="${escapeHtml(`${PRICE_BLOCK.open}: ${name}`)}">${escapeHtml(PRICE_BLOCK.open)}${CHEVRON}</button></div>`
  );
}

function node(item: GenuiNode, live: Live, place: Place = "top", timed = false): string {
  const props = item.props;
  switch (item.typeName) {
    case "Panel":
      return `<div class="lv-panel">${replyBlocks(props.blocks)
        .map((block) => `<div class="lv-sec">${node(block, live)}</div>`)
        .join("")}</div>`;
    case "List": {
      const body = genuiNodes(props.rows).length
        ? rows(props.rows, live)
        : `<p class="lv-empty">${escapeHtml(text(props.empty) || "Nothing here yet")}</p>`;
      const foot = props.open ? `<div class="lv-foot">${node(props.open as GenuiNode, live)}</div>` : "";
      return body + foot;
    }
    case "Card": {
      const title = text(props.title);
      const head =
        `<div class="lv-head"><span class="${place === "column" ? "lv-head-title" : "lv-eyebrow"}">${escapeHtml(place === "column" ? title : title.toUpperCase())}</span>` +
        (text(props.meta) ? `<span class="lv-head-meta">${escapeHtml(props.meta)}</span>` : "") +
        "</div>";
      const foot = props.open ? `<div class="lv-foot">${node(props.open as GenuiNode, live)}</div>` : "";
      return `<div class="lv-card" aria-label="${escapeHtml(title)}">${head}${rows(props.rows, live)}${foot}</div>`;
    }
    case "Columns":
      return genuiNodes(props.cards)
        .map((card) => `<div class="lv-item">${node(card, live, "column")}</div>`)
        .join("");
    case "Stats": {
      const items = genuiNodes(props.items);
      if (!items.length) return "";
      const columns = items.length === 4 ? 2 : Math.min(items.length, 3);
      return `<div class="lv-stats" style="grid-template-columns:repeat(${columns},minmax(0,1fr))">${items
        .map((stat, index) => {
          const edges = `${index % columns > 0 ? " is-left" : ""}${index >= columns ? " is-top" : ""}`;
          return `<div class="lv-stat${edges}">${node(stat, live)}</div>`;
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
      const task = live.task(id);
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
    case "CheckRow": {
      const docId = text(props.docId);
      const items = live.checklist(docId);
      const item = items ? findChecklistItem(items, text(props.text), typeof props.item === "number" ? props.item : undefined) : undefined;
      const title = item?.text ?? text(props.text);
      const done = Boolean(item?.done);
      const check =
        `<button type="button" class="lv-check${done ? " is-done" : ""}" role="checkbox" aria-checked="${done}"` +
        ` aria-label="${escapeHtml(`${done ? "Untick" : "Tick"} ${title}`)}"` +
        (item
          ? ` data-live-check="${escapeHtml(docId)}" data-item="${item.item}" data-text="${escapeHtml(item.text)}" data-done="${done ? 1 : 0}"`
          : " disabled") +
        `>${CHECK}</button>`;
      const name = items
        ? `<button type="button" class="lv-title-btn" data-live-open="${escapeHtml(`timely://doc/${encodeURIComponent(docId)}`)}"><span class="lv-title${done ? " is-done" : ""}">${escapeHtml(title)}</span></button>`
        : `<span class="lv-title">${escapeHtml(title)}</span>`;
      return row({ timed, lead: check, body: name, meta: text(props.note) });
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
    case "PriceHistory":
      return priceBlock(props, live);
    default:
      return "";
  }
}

/**
 * The block's HTML for the editor page; empty when the program could not be
 * drawn. problem says what the program names that the sheets and docs don't have
 * (blockProblems), over the drawing.
 */
export function liveBlockHtml(root: GenuiNode | null, live: Live, problem = ""): string {
  if (!root) return "";
  const note = problem ? `<p class="lv-problem" role="status">${WARNING}<span>${escapeHtml(problem)}</span></p>` : "";
  return note + node(root, live);
}
