"use no memo";
import { Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { FlexWidget, SvgWidget, TextWidget, type ColorProp } from "react-native-android-widget";
import { darkColors, lightColors, type ColorTokens } from "@timely/contract/designTokens";
import { WIDGET_ACTION, type WidgetAction } from "./actions";
import type { WidgetButton, WidgetGlyph, WidgetModel, WidgetRow, WidgetTone } from "./model";

/**
 * Draws a WidgetModel as an Android home screen widget, in Timely's light and
 * dark colours (the launcher picks one with the system theme). Layout follows
 * the widget's size: a 2x2 shows the figure and a line, taller ones add rows,
 * bars or meters.
 */

type Hex = `#${string}`;
type Size = { width: number; height: number };
/** `preview`: the card picker's still preview, where a live clock is drawn as plain text. */
type Options = { preview?: boolean };

const TRANSPARENT = "#00000000" as Hex;

/** clickActionData for a button that works on the home screen (Android passes it as a flat bundle). */
function actionData(action: WidgetAction): Record<string, unknown> {
  return { ...action };
}

const DISPLAY_FONT = "Archivo-CondensedExtraBold";

/**
 * Line heights the widget library really draws, measured with its own Android
 * code: the system font takes about 1.36x its size and Archivo condensed about
 * 1.52x. Every block is budgeted from these so nothing is pushed past the
 * widget's edge (a guess of 54dp for a 34sp figure clipped 82 of 370 cases).
 */
const lineH = (sp: number) => Math.ceil(sp * 1.36);
const figureH = (sp: number) => Math.ceil(sp * 1.52);
const PAD = 14;
const GAP = 6;
const HEADER_H = lineH(12) + GAP;
const ROW_H = 28;
const BAR_LABEL_H = lineH(10) + 3;
const METER_H = 20;
const NOTE_LINE_H = 20;
const RING_TEXT_H = figureH(28);
/** Archivo condensed takes about 0.46em a character. */
const figureFor = (value: string, width: number) => Math.floor(width / (0.46 * Math.max(3, value.length)));
const captionH = (lines: number) => (lines ? lines * lineH(12) + 1 : 0);
/** Rough line count for a 12sp caption (about 6.4dp a character). */
const captionNeeds = (text: string | undefined, width: number) => (text ? Math.max(1, Math.ceil((text.length * 6.4) / width)) : 0);

type WidgetElement = ReactElement<{ children?: ReactNode }>;

/**
 * The widget library expands our components itself but breaks on two things
 * React allows: a component that returns null (Stat with no figure) and a
 * Fragment. Either one threw for every Dashboard card on the phone, so the
 * tree is expanded here first, down to the library's own widgets.
 */
function expand(node: ReactNode): ReactNode[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!isValidElement(node)) return [node];
  const element = node as WidgetElement;
  if (element.type === Fragment) return expand(element.props.children);
  const type = element.type as { __name__?: string } | ((props: unknown) => ReactNode);
  if (typeof type === "function" && !("__name__" in type && type.__name__)) return expand(type(element.props));
  const children = element.props.children === undefined ? undefined : expand(element.props.children);
  if (children === undefined) return [element];
  // Passing no children to cloneElement keeps the old ones, so an emptied list is set outright.
  return [children.length ? cloneElement(element, undefined, ...children) : cloneElement(element, { children: undefined })];
}

function widgetTree(node: ReactNode): ReactElement {
  const [root] = expand(node);
  if (!isValidElement(root)) throw new Error("A widget must draw one root widget");
  return root;
}

function palette(dark: boolean) {
  const t: ColorTokens = dark ? darkColors : lightColors;
  return {
    bg: t.card as Hex,
    fg: t.foreground as Hex,
    muted: t.mutedForeground as Hex,
    accent: t.primary as Hex,
    accentFg: t.primaryForeground as Hex,
    soft: t.accent as Hex,
    softFg: t.accentForeground as Hex,
    fill: t.fill as Hex,
    border: (dark ? "rgba(255, 255, 255, 0.08)" : t.border) as ColorProp,
    danger: t.destructive as Hex,
    success: t.success as Hex,
  };
}

type Palette = ReturnType<typeof palette>;

function toneColor(p: Palette, tone: WidgetTone | undefined): Hex {
  switch (tone) {
    case "muted":
      return p.muted;
    case "accent":
      return p.accent;
    case "danger":
      return p.danger;
    case "success":
      return p.success;
    default:
      return p.fg;
  }
}

function isHex(value?: string): value is Hex {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

function Header({ model, p }: { model: WidgetModel; p: Palette }) {
  return (
    <FlexWidget style={{ flexDirection: "row", alignItems: "center", width: "match_parent", marginBottom: 6 }}>
      <FlexWidget style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.accent, marginRight: 6 }} />
      <TextWidget
        text={model.title}
        maxLines={1}
        truncate="END"
        style={{ fontSize: 12, fontWeight: "600", color: p.muted, letterSpacing: 0.2 }}
      />
    </FlexWidget>
  );
}

function Stat({ model, p, figure, captionLines, live }: { model: WidgetModel; p: Palette; figure: number; captionLines: number; live?: boolean }) {
  if (!figure && !captionLines) return null;
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent", marginBottom: GAP }}>
      {figure && model.value && model.timer?.running && live ? (
        // The launcher ticks this one itself: the bitmap keeps the space, a
        // system Chronometer draws the time (patches/react-native-android-widget).
        // A paused clock stays bitmap text: a stopped Chronometer works its
        // time out again whenever the launcher redraws, and would drift.
        <TextWidget
          text={model.value}
          maxLines={1}
          clickAction="CHRONOMETER"
          clickActionData={{ ...model.timer, color: p.fg, fontSize: figure, gravity: "start" }}
          style={{ fontSize: figure, fontFamily: DISPLAY_FONT, color: TRANSPARENT, letterSpacing: -0.3 }}
        />
      ) : figure && model.value ? (
        <TextWidget
          text={model.value}
          maxLines={1}
          truncate="END"
          style={{ fontSize: figure, fontFamily: DISPLAY_FONT, color: p.fg, letterSpacing: -0.3 }}
        />
      ) : null}
      {captionLines && model.caption ? (
        <TextWidget
          text={model.caption}
          maxLines={captionLines}
          truncate="END"
          style={{ fontSize: 12, color: toneColor(p, model.captionTone ?? "muted"), marginTop: 1 }}
        />
      ) : null}
    </FlexWidget>
  );
}

function Check({ row, p }: { row: WidgetRow; p: Palette }) {
  return (
    <FlexWidget
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: row.done ? 0 : 1.5,
        borderColor: row.toggle ? p.accent : p.muted,
        backgroundColor: row.done ? p.success : p.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {row.done ? <SvgWidget svg={TICK(p.bg)} style={{ width: 10, height: 10 }} /> : null}
    </FlexWidget>
  );
}

const TICK = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

/** `checks`: some rows in the list have a checkbox, so markers take the same column and titles line up. */
function Row({ row, p, fallbackUri, checks, height = ROW_H }: { row: WidgetRow; p: Palette; fallbackUri: string; checks?: boolean; height?: number }) {
  const bar = isHex(row.color) ? row.color : row.tone === "accent" ? p.accent : p.soft;
  // A row with nothing to open (a habit) ticks wherever it's tapped.
  const ticksAll = Boolean(row.toggle && !row.uri);
  return (
    <FlexWidget
      {...(ticksAll
        ? { clickAction: WIDGET_ACTION, clickActionData: actionData(row.toggle!) }
        : { clickAction: "OPEN_URI", clickActionData: { uri: row.uri ?? fallbackUri } })}
      accessibilityLabel={row.toggle ? `${row.title}, ${row.done ? "done" : "not done"}` : row.title}
      style={{ flexDirection: "row", alignItems: "center", width: "match_parent", height }}
    >
      {row.toggle && !ticksAll ? (
        // The checkbox gets its own wide tap target; the title still opens the item.
        <FlexWidget
          clickAction={WIDGET_ACTION}
          clickActionData={actionData(row.toggle)}
          accessibilityLabel={`${row.done ? "Untick" : "Tick"} ${row.title}`}
          style={{ height, paddingRight: 10, justifyContent: "center" }}
        >
          <Check row={row} p={p} />
        </FlexWidget>
      ) : row.done !== undefined ? (
        <FlexWidget style={{ marginRight: 10 }}>
          <Check row={row} p={p} />
        </FlexWidget>
      ) : checks ? (
        <FlexWidget style={{ width: 16, height: 16, marginRight: 10, alignItems: "center", justifyContent: "center" }}>
          <FlexWidget style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: bar }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: bar, marginRight: 8 }} />
      )}
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget
          text={row.title}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 13, color: row.done ? p.muted : toneColor(p, row.tone === "accent" ? "default" : row.tone) }}
        />
      </FlexWidget>
      {row.meta ? (
        <TextWidget text={row.meta} maxLines={1} style={{ fontSize: 12, color: row.tone === "accent" ? p.accent : p.muted, marginLeft: 8 }} />
      ) : null}
    </FlexWidget>
  );
}

/** `tall`: the tallest bar, from whatever height is left under the header (and figure). */
function Bars({ model, p, tall, width }: { model: WidgetModel; p: Palette; tall: number; width: number }) {
  const bars = model.bars ?? [];
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  // Three letters need about 24dp a column; narrower charts label with one.
  const letters = width / Math.max(1, bars.length) >= 24 ? 3 : 1;
  const labels = (
    <FlexWidget style={{ flexDirection: "row", width: "match_parent" }}>
      {bars.map((bar, index) => (
        <FlexWidget key={`${bar.label}-${index}`} style={{ flex: 1, width: 0, alignItems: "center" }}>
          <TextWidget text={bar.label.slice(0, letters)} maxLines={1} style={{ fontSize: 10, color: p.muted, marginTop: 3 }} />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
  if (model.line) {
    return (
      <FlexWidget style={{ flexDirection: "column", width: "match_parent", flex: 1, justifyContent: "flex-end" }}>
        <SvgWidget svg={lineSvg(bars, p, width, tall)} style={{ width, height: tall }} />
        {labels}
      </FlexWidget>
    );
  }
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent", flex: 1, justifyContent: "flex-end" }}>
      <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end", width: "match_parent" }}>
        {bars.map((bar, index) => (
          <FlexWidget key={`${bar.label}-${index}`} style={{ flex: 1, width: 0, alignItems: "center" }}>
            <FlexWidget
              style={{
                width: 12,
                height: Math.max(3, Math.round((bar.value / max) * tall)),
                borderRadius: 4,
                backgroundColor: bar.highlight ? p.accent : p.fill,
              }}
            />
          </FlexWidget>
        ))}
      </FlexWidget>
      {labels}
    </FlexWidget>
  );
}

/** A line through each column's middle, so its points sit over the labels like the bars do. */
function lineSvg(points: { value: number; highlight?: boolean }[], p: Palette, width: number, tall: number) {
  const values = points.map((point) => point.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const step = width / Math.max(1, points.length);
  const xy = points.map((point, index) => [(index + 0.5) * step, 5 + (1 - (point.value - min) / (max - min || 1)) * (tall - 10)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1];
  const area = xy.length ? `${xy[0][0].toFixed(1)},${tall} ${line} ${last[0].toFixed(1)},${tall}` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${tall}" viewBox="0 0 ${width} ${tall}">
<polygon points="${area}" fill="${p.accent}" fill-opacity="0.12"/>
<polyline points="${line}" fill="none" stroke="${p.accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
${last ? `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="${p.accent}"/>` : ""}
</svg>`;
}

function ringSvg(share: number, p: Palette) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const filled = Math.min(1, Math.max(0, share)) * c;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="${r}" fill="none" stroke="${p.fill}" stroke-width="9"/>
${filled > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${share >= 1 ? p.success : p.accent}" stroke-width="9" stroke-linecap="round"
 stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>` : ""}
</svg>`;
}

function Ring({ model, p, d, labelLines }: { model: WidgetModel; p: Palette; d: number; labelLines: number }) {
  const ring = model.ring;
  if (!ring) return null;
  const share = ring.target ? ring.value / ring.target : 0;
  return (
    <FlexWidget style={{ flexDirection: "row", alignItems: "center", width: "match_parent", flex: 1 }}>
      <SvgWidget svg={ringSvg(share, p)} style={{ width: d, height: d }} />
      <FlexWidget style={{ flexDirection: "column", marginLeft: 12, flex: 1 }}>
        <TextWidget text={`${Math.round(Math.min(1, share) * 100)}%`} style={{ fontSize: 28, fontFamily: DISPLAY_FONT, color: p.fg }} />
        <TextWidget text={ring.label} maxLines={labelLines} truncate="END" style={{ fontSize: 12, color: p.muted }} />
      </FlexWidget>
    </FlexWidget>
  );
}

const meterWeight = (share: number) => Math.max(1, Math.round(Math.min(1, Math.max(0, share)) * 1000));

function Meters({ model, p, count }: { model: WidgetModel; p: Palette; count: number }) {
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      {(model.meters ?? []).slice(0, count).map((meter) => (
        <FlexWidget key={meter.label} style={{ flexDirection: "row", alignItems: "center", width: "match_parent", height: 20 }}>
          <TextWidget text={meter.label} style={{ fontSize: 12, color: p.muted, width: 44 }} />
          <FlexWidget style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: p.fill, flexDirection: "row" }}>
            {/* Android weights are whole numbers (a 0.39 weight drew no fill at all), so shares are out of 1000. */}
            <FlexWidget style={{ flex: meterWeight(meter.value), width: 0, height: 6, borderRadius: 3, backgroundColor: p.accent }} />
            <FlexWidget style={{ flex: meterWeight(1 - meter.value), width: 0, height: 6 }} />
          </FlexWidget>
          <TextWidget text={meter.detail ?? ""} style={{ fontSize: 11, color: p.muted, width: 36, textAlign: "right" }} />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

const BUTTON_GLYPHS: Record<WidgetGlyph, string[]> = {
  play: ["M6 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L7.5 3.64A1 1 0 0 0 6 4.5z"],
  pause: ["M8 4v16", "M16 4v16"],
  skip: ["M5 4.5v15l10-7.5z", "M19 5v14"],
  reset: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5"],
  plus: ["M5 12h14", "M12 5v14"],
  minus: ["M5 12h14"],
  lap: ["M12 13V9", "M10 2h4", "M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"],
  inbox: [
    "M22 12h-6l-2 3h-4l-2-3H2",
    "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  ],
};

/** Counter buttons read − value +, so + is the main one; otherwise the first button is. */
function primaryIndex(buttons: WidgetButton[]) {
  return buttons.length === 2 && buttons[0].glyph === "minus" ? 1 : 0;
}

/** `stacked`: one above the other, beside a wide widget's clock. */
function Buttons({ model, p, width, height, stacked }: { model: WidgetModel; p: Palette; width: number; height: number; stacked?: boolean }) {
  const buttons = model.buttons ?? [];
  const primary = primaryIndex(buttons);
  // A row shows the same thing on every button: icon and label where all fit,
  // else labels (for links), else icons (in-place controls like play or + go
  // straight to icons). TalkBack always gets the label.
  const per = stacked ? width : (width - GAP * (buttons.length - 1)) / Math.max(1, buttons.length);
  const textW = (button: WidgetButton) => button.label.length * 6.6;
  const rowShows = buttons.every((button) => !button.glyph || textW(button) + 42 <= per)
    ? "both"
    : buttons.every((button) => !button.action && textW(button) + 10 <= per)
      ? "label"
      : "icon";
  const show = (button: WidgetButton) => ({
    glyph: Boolean(button.glyph) && rowShows !== "label",
    label: !button.glyph || rowShows !== "icon",
  });
  return (
    <FlexWidget style={{ flexDirection: stacked ? "column" : "row", width: "match_parent", marginTop: stacked ? 0 : GAP }}>
      {buttons.map((button, index) => {
        const main = index === primary;
        const fg = main ? p.accentFg : p.softFg;
        const shown = show(button);
        const glyph = button.glyph && shown.glyph ? BUTTON_GLYPHS[button.glyph] : null;
        return (
          <FlexWidget
            key={button.label}
            {...(button.action
              ? { clickAction: WIDGET_ACTION, clickActionData: actionData(button.action) }
              : { clickAction: "OPEN_URI", clickActionData: { uri: button.uri ?? model.uri } })}
            accessibilityLabel={button.label}
            style={{
              ...(stacked ? { width: "match_parent" as const, marginTop: index === 0 ? 0 : GAP } : { flex: 1, width: 0, marginLeft: index === 0 ? 0 : GAP }),
              height,
              borderRadius: 12,
              backgroundColor: main ? p.accent : p.soft,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {glyph ? <SvgWidget svg={GLYPH(glyph, fg, button.glyph === "play")} style={{ width: 16, height: 16 }} /> : null}
            {shown.label ? (
              <TextWidget
                text={button.label}
                maxLines={1}
                truncate="END"
                style={{ fontSize: 13, fontWeight: "600", color: fg, marginLeft: glyph ? 6 : 0 }}
              />
            ) : null}
          </FlexWidget>
        );
      })}
    </FlexWidget>
  );
}

export type CardPlan = {
  mode: "column" | "wide" | "wideClock";
  header: boolean;
  /** Figure size in sp, 0 for none. */
  figure: number;
  captionLines: number;
  rows: number;
  /** Rows grow (up to 40dp) when they all fit, so a short list spreads over a tall widget. */
  rowH: number;
  /** Tallest bar in dp, 0 for no bars. */
  bars: number;
  /** Width the chart gets, for a line drawn to fit. */
  chartW: number;
  meters: number;
  /** Ring diameter in dp, 0 for no ring. */
  ring: number;
  ringLabelLines: number;
  noteLines: number;
  emptyLines: number;
  /** Lifts a centred empty message to the card's middle, as far as the room allows. */
  emptyPad: number;
  buttonH: number;
  /** A clock or counter: its figure grows and sits in the middle of the space above its buttons. */
  hero: boolean;
  /** wideClock: buttons one above the other (else an icon row). */
  stacked: boolean;
  /** wideClock: width of the button column. */
  buttonsW: number;
};

/** A ring needs room for itself and its figure beside it; smaller widgets show the share as a figure. */
function ringAsFigure(model: WidgetModel, size: Size): WidgetModel {
  const ring = model.ring;
  if (!ring) return model;
  const innerW = size.width - 2 * PAD - 2;
  const room = size.height - 2 * PAD - 2 - HEADER_H;
  if (innerW >= 190 && room >= RING_TEXT_H + lineH(12)) return model;
  const share = ring.target ? ring.value / ring.target : 0;
  return { ...model, ring: undefined, value: `${Math.round(Math.min(1, share) * 100)}%`, caption: ring.label };
}

/** Works out what fits: every height here is what Android really draws. */
export function planCard(model: WidgetModel, size: Size): CardPlan {
  const innerW = size.width - 2 * PAD - 2;
  const innerH = size.height - 2 * PAD - 2;
  const buttons = model.buttons?.length ?? 0;
  const rowsWanted = model.rows?.length ?? 0;
  const short = size.height < 220;
  const sideRoom = innerH - HEADER_H;
  // Room in a wide widget's left column for the figure, a caption line and a button under them.
  const columnFitsButton = sideRoom >= figureH(24) + captionH(1) + 36 + 2 * GAP;
  const wideClock =
    size.width >= 260 && short && buttons > 0 && Boolean(model.timer || model.value) && !model.ring && !model.meters && (!rowsWanted || !columnFitsButton);
  const wide =
    !wideClock && size.width >= 260 && short && Boolean(model.value) && !model.ring && !model.meters && buttons <= 1 && Boolean(rowsWanted || model.bars?.length);
  const plan: CardPlan = {
    mode: wideClock ? "wideClock" : wide ? "wide" : "column",
    header: true,
    figure: 0,
    captionLines: 0,
    rows: 0,
    rowH: ROW_H,
    bars: 0,
    chartW: innerW,
    meters: 0,
    ring: 0,
    ringLabelLines: 0,
    noteLines: 0,
    emptyLines: 0,
    emptyPad: 0,
    buttonH: 0,
    stacked: false,
    buttonsW: 0,
    hero: false,
  };

  /** Fits the figure and caption into `room` x `width`, keeping `reserve` free under them; returns the height used. */
  const stat = (room: number, width: number, grow: boolean, max: number, reserve = 0) => {
    let lines = Math.min(2, captionNeeds(model.caption, width));
    if (!model.value) {
      lines = Math.max(0, Math.min(lines, Math.floor((room - GAP - 1) / lineH(12))));
      plan.captionLines = lines;
      return lines ? captionH(lines) + GAP : 0;
    }
    const smallest = figureH(20);
    // Holding room for one row is pointless when the row can't fit anyway.
    if (room - figureH(24) - GAP < reserve) reserve = 0;
    while (lines && room - captionH(lines) - GAP - reserve < (grow ? figureH(24) : smallest)) lines--;
    const byWidth = figureFor(model.value, width);
    const byHeight = Math.floor((room - captionH(lines) - GAP - (grow ? 0 : reserve)) / 1.52);
    plan.figure = Math.max(18, Math.min(max, byWidth, grow ? byHeight : Math.max(byHeight >= 34 ? 34 : 24, Math.min(34, byHeight))));
    if (!grow && plan.figure > byHeight) plan.figure = Math.max(18, byHeight);
    plan.captionLines = lines;
    return figureH(plan.figure) + captionH(lines) + GAP;
  };

  if (wideClock) {
    const room = innerH - HEADER_H;
    const fits = (h: number) => buttons * h + (buttons - 1) * GAP <= room;
    plan.stacked = fits(36);
    plan.buttonH = plan.stacked ? (fits(40) ? 40 : 36) : Math.min(40, room);
    plan.buttonsW = plan.stacked ? 132 : buttons * 44 + (buttons - 1) * GAP;
    stat(room, innerW - plan.buttonsW - 12, true, 96);
    return plan;
  }
  if (wide) {
    const room = innerH - HEADER_H;
    if (buttons) plan.buttonH = 36;
    stat(room - (buttons ? plan.buttonH + GAP : 0), 112, false, 34);
    plan.rows = Math.min(rowsWanted, Math.max(1, Math.floor(room / ROW_H)));
    if (!rowsWanted) plan.bars = Math.max(12, Math.min(140, room - BAR_LABEL_H - 2));
    plan.chartW = innerW - 112 - 12;
    return plan;
  }

  let left = innerH - HEADER_H;
  if (buttons) {
    plan.buttonH = innerH >= 130 ? 40 : 34;
    left -= plan.buttonH + GAP;
    // A small clock gives up its title before its figure.
    if (model.value && left < figureH(22)) {
      plan.header = false;
      left += HEADER_H;
    }
  }
  if (model.ring) {
    // The ring grows with the widget, leaving its figure and label a column beside it.
    plan.ring = Math.max(56, Math.min(160, left, innerW - 12 - 96));
    plan.ringLabelLines = Math.max(1, Math.min(2, Math.floor((plan.ring - RING_TEXT_H) / lineH(12))));
    return plan;
  }
  const showBars = Boolean(model.bars?.length) && size.height >= 150;
  const alone = !rowsWanted && !showBars && !model.meters && !model.note && !buttons && !model.empty;
  // A clock or counter (a figure with in-place buttons) is the point of its widget, so it grows.
  const hero = Boolean(model.value) && Boolean(model.timer || model.buttons?.some((button) => button.action)) && !rowsWanted;
  plan.hero = hero;
  const reserve = rowsWanted || showBars ? ROW_H : model.meters ? METER_H : model.note || model.empty ? NOTE_LINE_H : 0;
  left -= stat(left, innerW, alone || hero, alone ? 120 : hero ? 96 : 34, reserve);
  if (model.meters) {
    plan.meters = Math.min(model.meters.length, Math.max(0, Math.floor(left / METER_H)));
    left -= plan.meters * METER_H;
  }
  if (showBars && left >= BAR_LABEL_H + 12) {
    plan.bars = Math.min(140, left - BAR_LABEL_H - 2);
    left = 0;
  }
  if (!plan.bars) {
    plan.rows = Math.min(rowsWanted, Math.max(0, Math.floor(left / ROW_H)));
    if (plan.rows && plan.rows === rowsWanted && !buttons) plan.rowH = Math.max(ROW_H, Math.min(40, Math.floor(left / plan.rows)));
    left -= plan.rows * plan.rowH;
  }
  if (model.note) plan.noteLines = Math.max(0, Math.floor((left - 2) / NOTE_LINE_H));
  if (model.empty && !plan.rows && !model.note) {
    plan.emptyLines = Math.max(0, Math.min(3, Math.floor((left - 2) / lineH(13))));
    plan.emptyPad = Math.max(0, Math.min(HEADER_H, left - 2 - plan.emptyLines * lineH(13)));
  }
  return plan;
}

function Card({ model: given, dark, size, options }: { model: WidgetModel; dark: boolean; size: Size; options: Options }) {
  const live = !options.preview;
  const p = palette(dark);
  const model = ringAsFigure(given, size);
  const plan = planCard(model, size);
  const rows = (model.rows ?? []).slice(0, plan.rows);
  const checks = (model.rows ?? []).some((row) => row.done !== undefined);
  const stat = <Stat model={model} p={p} figure={plan.figure} captionLines={plan.captionLines} live={live} />;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: model.uri }}
      accessibilityLabel={`${model.title}${model.value ? `, ${model.value}` : ""}${model.caption ? `, ${model.caption}` : ""}`}
      style={{
        height: "match_parent",
        width: "match_parent",
        flexDirection: "column",
        backgroundColor: p.bg,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: p.border,
        padding: PAD,
      }}
    >
      {plan.header ? <Header model={model} p={p} /> : null}
      {plan.mode === "wideClock" ? (
        // A wide clock keeps its buttons beside the time instead of under it.
        <FlexWidget style={{ flexDirection: "row", width: "match_parent", flex: 1, alignItems: "center" }}>
          <FlexWidget style={{ flexDirection: "column", flex: 1, marginRight: 12 }}>{stat}</FlexWidget>
          <FlexWidget style={{ flexDirection: "column", width: plan.buttonsW }}>
            <Buttons model={model} p={p} width={plan.buttonsW} height={plan.buttonH} stacked={plan.stacked} />
          </FlexWidget>
        </FlexWidget>
      ) : plan.mode === "wide" ? (
        // A wide widget puts the figure on the left and the detail beside it,
        // so a 4x2 shows twice the rows instead of an empty right half.
        <FlexWidget style={{ flexDirection: "row", width: "match_parent", flex: 1 }}>
          <FlexWidget style={{ flexDirection: "column", width: 112, marginRight: 12 }}>
            {stat}
            {model.buttons?.length ? (
              <FlexWidget style={{ flex: 1, width: "match_parent", flexDirection: "column", justifyContent: "flex-end" }}>
                <Buttons model={model} p={p} width={112} height={plan.buttonH} />
              </FlexWidget>
            ) : null}
          </FlexWidget>
          <FlexWidget style={{ flexDirection: "column", flex: 1 }}>
            {plan.bars ? <Bars model={model} p={p} tall={plan.bars} width={plan.chartW} /> : null}
            {!plan.bars ? rows.map((row, index) => <Row key={`${row.title}-${index}`} row={row} p={p} fallbackUri={model.uri} checks={checks} />) : null}
          </FlexWidget>
        </FlexWidget>
      ) : (
        // The widget library has no Fragment, so siblings go in as a plain list.
        [
          plan.ring ? <Ring key="ring" model={model} p={p} d={plan.ring} labelLines={plan.ringLabelLines} /> : null,
          // A lone figure sits at the bottom, under the title, like a clock widget;
          // a clock with buttons sits in the middle of the space above them.
          !plan.ring && !rows.length && !plan.bars && !plan.meters && !model.note && !plan.emptyLines && (!model.buttons?.length || plan.hero) ? (
            <FlexWidget key="spacer" style={{ flex: 1, width: "match_parent" }} />
          ) : null,
          !plan.ring ? <FlexWidget key="stat" style={{ width: "match_parent" }}>{stat}</FlexWidget> : null,
          plan.meters ? <Meters key="meters" model={model} p={p} count={plan.meters} /> : null,
          plan.bars ? <Bars key="bars" model={model} p={p} tall={plan.bars} width={plan.chartW} /> : null,
          rows.length ? (
            <FlexWidget key="rows" style={{ flexDirection: "column", width: "match_parent" }}>
              {rows.map((row, index) => (
                <Row key={`${row.title}-${index}`} row={row} p={p} fallbackUri={model.uri} checks={checks} height={plan.rowH} />
              ))}
            </FlexWidget>
          ) : null,
        ]
      )}
      {model.note && plan.noteLines ? (
        <TextWidget text={model.note} maxLines={plan.noteLines} truncate="END" style={{ fontSize: 14, color: p.fg, lineHeight: 19 }} />
      ) : null}
      {model.empty && plan.emptyLines && (model.value || model.buttons?.length) ? (
        <TextWidget text={model.empty} maxLines={plan.emptyLines} truncate="END" style={{ fontSize: 13, color: p.muted }} />
      ) : model.empty && plan.emptyLines ? (
        // A card with nothing but its empty message centres it, instead of a line at the top of a blank card.
        <FlexWidget style={{ flex: 1, width: "match_parent", alignItems: "center", justifyContent: "center", paddingBottom: plan.emptyPad }}>
          <TextWidget text={model.empty} maxLines={plan.emptyLines} truncate="END" style={{ fontSize: 13, color: p.muted, textAlign: "center" }} />
        </FlexWidget>
      ) : null}
      {model.buttons?.length && plan.mode === "column" ? (
        <FlexWidget style={{ flex: 1, width: "match_parent", flexDirection: "column", justifyContent: "flex-end" }}>
          <Buttons model={model} p={p} width={size.width - 2 * PAD} height={plan.buttonH} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

export function renderCard(model: WidgetModel, size: Size, options: Options = {}) {
  return {
    light: widgetTree(<Card model={model} dark={false} size={size} options={options} />),
    dark: widgetTree(<Card model={model} dark size={size} options={options} />),
  };
}

export type QuickAddButton = { label: string; uri: string; glyph: string };

const GLYPH = (paths: string[], color: string, filled = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${filled ? color : "none"}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths
    .map((d) => `<path d="${d}"/>`)
    .join("")}</svg>`;

export const QUICK_ADD_GLYPHS: Record<string, string[]> = {
  task: ["M5 12h14", "M12 5v14"],
  capture: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  ask: [
    "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
  ],
  search: ["m21 21-4.34-4.34", "M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z"],
};

/**
 * Quick add as a capture bar: "Add a task" fills the left like a search
 * field, with Capture, Ask and Search as round buttons on the right. Every
 * part of the bar belongs to one of the four tap zones and each zone runs the
 * full height, so there are no dead gaps between buttons.
 */
function QuickAdd({ buttons, dark, size }: { buttons: QuickAddButton[]; dark: boolean; size: Size }) {
  const p = palette(dark);
  const [main, ...rest] = buttons;
  const round = Math.max(12, Math.min(28, Math.floor(size.height / 2)));
  const bubble = Math.max(28, Math.min(40, size.height - 16));
  // Below about 4 cells the prompt can't fit; the four buttons then spread evenly.
  const prompt = size.width >= 290;
  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: p.bg,
        borderRadius: round,
        borderWidth: 1,
        borderColor: p.border,
        paddingHorizontal: 4,
      }}
    >
      {main ? (
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: main.uri }}
          accessibilityLabel={main.label === "Task" ? "Add a task" : main.label}
          style={{
            // Every zone shares the bar by weight, so there's no dead gap between them.
            ...(prompt ? { flex: 3, paddingLeft: 4 } : { flex: 1, justifyContent: "center" as const }),
            width: 0,
            height: "match_parent",
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <FlexWidget
            style={{ width: bubble, height: bubble, borderRadius: bubble / 2, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" }}
          >
            <SvgWidget svg={GLYPH(QUICK_ADD_GLYPHS[main.glyph] ?? [], p.accentFg)} style={{ width: 20, height: 20 }} />
          </FlexWidget>
          {prompt ? (
            <TextWidget
              text={main.label === "Task" ? "Add a task" : main.label}
              maxLines={1}
              truncate="END"
              style={{ fontSize: 15, color: p.muted, marginLeft: 10 }}
            />
          ) : null}
        </FlexWidget>
      ) : null}
      {rest.map((button) => (
        <FlexWidget
          key={button.label}
          clickAction="OPEN_URI"
          clickActionData={{ uri: button.uri }}
          accessibilityLabel={button.label}
          style={{ flex: 1, width: 0, height: "match_parent", alignItems: "center", justifyContent: "center" }}
        >
          <FlexWidget
            style={{ width: bubble, height: bubble, borderRadius: bubble / 2, backgroundColor: p.soft, alignItems: "center", justifyContent: "center" }}
          >
            <SvgWidget svg={GLYPH(QUICK_ADD_GLYPHS[button.glyph] ?? [], p.softFg)} style={{ width: 18, height: 18 }} />
          </FlexWidget>
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

export function renderQuickAdd(buttons: QuickAddButton[], size: Size) {
  return {
    light: widgetTree(<QuickAdd buttons={buttons} dark={false} size={size} />),
    dark: widgetTree(<QuickAdd buttons={buttons} dark size={size} />),
  };
}
