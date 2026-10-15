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
  return [children === undefined ? element : cloneElement(element, undefined, ...children)];
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

function Stat({ model, p, size, alone, live }: { model: WidgetModel; p: Palette; size: Size; alone?: boolean; live?: boolean }) {
  if (!model.value && !model.caption) return null;
  const big = size.height >= 110 && size.width >= 110;
  // A figure with nothing under it grows with the widget instead of leaving it empty.
  // A live clock is the point of its widget, so it grows too, leaving room for its buttons.
  const hero = Boolean(model.timer) && !model.rows?.length;
  const figure = alone
    ? Math.max(34, Math.min(64, Math.round(Math.min(size.width, size.height) * 0.3)))
    : hero
      ? Math.max(30, Math.min(56, Math.round(Math.min(size.width, size.height - 50) * 0.32)))
      : big
        ? 34
        : 24;
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent", marginBottom: 6 }}>
      {model.value && model.timer?.running && live ? (
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
      ) : model.value ? (
        <TextWidget
          text={model.value}
          maxLines={1}
          truncate="END"
          style={{ fontSize: figure, fontFamily: DISPLAY_FONT, color: p.fg, letterSpacing: -0.3 }}
        />
      ) : null}
      {model.caption ? (
        <TextWidget
          text={model.caption}
          maxLines={2}
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
function Row({ row, p, fallbackUri, checks }: { row: WidgetRow; p: Palette; fallbackUri: string; checks?: boolean }) {
  const bar = isHex(row.color) ? row.color : row.tone === "accent" ? p.accent : p.soft;
  // A row with nothing to open (a habit) ticks wherever it's tapped.
  const ticksAll = Boolean(row.toggle && !row.uri);
  return (
    <FlexWidget
      {...(ticksAll
        ? { clickAction: WIDGET_ACTION, clickActionData: actionData(row.toggle!) }
        : { clickAction: "OPEN_URI", clickActionData: { uri: row.uri ?? fallbackUri } })}
      accessibilityLabel={row.toggle ? `${row.title}, ${row.done ? "done" : "not done"}` : row.title}
      style={{ flexDirection: "row", alignItems: "center", width: "match_parent", height: 28 }}
    >
      {row.toggle && !ticksAll ? (
        // The checkbox gets its own wide tap target; the title still opens the item.
        <FlexWidget
          clickAction={WIDGET_ACTION}
          clickActionData={actionData(row.toggle)}
          accessibilityLabel={`${row.done ? "Untick" : "Tick"} ${row.title}`}
          style={{ height: 28, paddingRight: 10, justifyContent: "center" }}
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
function Bars({ model, p, tall }: { model: WidgetModel; p: Palette; tall: number }) {
  const bars = model.bars ?? [];
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end", width: "match_parent", flex: 1 }}>
      {bars.map((bar, index) => (
        <FlexWidget key={`${bar.label}-${index}`} style={{ flexDirection: "column", alignItems: "center", flex: 1 }}>
          <FlexWidget
            style={{
              width: 12,
              height: Math.max(3, Math.round((bar.value / max) * tall)),
              borderRadius: 4,
              backgroundColor: bar.highlight ? p.accent : p.fill,
            }}
          />
          <TextWidget text={bar.label.slice(0, 3)} maxLines={1} style={{ fontSize: 10, color: p.muted, marginTop: 3 }} />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

function ringSvg(share: number, p: Palette) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const filled = Math.min(1, Math.max(0, share)) * c;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="${r}" fill="none" stroke="${p.fill}" stroke-width="9"/>
<circle cx="50" cy="50" r="${r}" fill="none" stroke="${share >= 1 ? p.success : p.accent}" stroke-width="9" stroke-linecap="round"
 stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>
</svg>`;
}

function Ring({ model, p, size }: { model: WidgetModel; p: Palette; size: Size }) {
  const ring = model.ring;
  if (!ring) return null;
  const share = ring.target ? ring.value / ring.target : 0;
  const d = Math.max(56, Math.min(96, Math.min(size.width - 120, size.height - 50)));
  return (
    <FlexWidget style={{ flexDirection: "row", alignItems: "center", width: "match_parent", flex: 1 }}>
      <SvgWidget svg={ringSvg(share, p)} style={{ width: d, height: d }} />
      <FlexWidget style={{ flexDirection: "column", marginLeft: 12, flex: 1 }}>
        <TextWidget text={`${Math.round(Math.min(1, share) * 100)}%`} style={{ fontSize: 28, fontFamily: DISPLAY_FONT, color: p.fg }} />
        <TextWidget text={ring.label} maxLines={2} style={{ fontSize: 12, color: p.muted }} />
      </FlexWidget>
    </FlexWidget>
  );
}

function Meters({ model, p }: { model: WidgetModel; p: Palette }) {
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      {(model.meters ?? []).map((meter) => (
        <FlexWidget key={meter.label} style={{ flexDirection: "row", alignItems: "center", width: "match_parent", height: 20 }}>
          <TextWidget text={meter.label} style={{ fontSize: 12, color: p.muted, width: 44 }} />
          <FlexWidget style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: p.fill, flexDirection: "row" }}>
            <FlexWidget style={{ flex: Math.max(0.01, meter.value), height: 6, borderRadius: 3, backgroundColor: p.accent }} />
            <FlexWidget style={{ flex: Math.max(0.01, 1 - meter.value), height: 6 }} />
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
};

/** Counter buttons read − value +, so + is the main one; otherwise the first button is. */
function primaryIndex(buttons: WidgetButton[]) {
  return buttons.length === 2 && buttons[0].glyph === "minus" ? 1 : 0;
}

/** `stacked`: one above the other, beside a wide widget's clock. */
function Buttons({ model, p, size, stacked }: { model: WidgetModel; p: Palette; size: Size; stacked?: boolean }) {
  const buttons = model.buttons ?? [];
  const primary = primaryIndex(buttons);
  // Narrow widgets show icon-only buttons; each still has its label for TalkBack.
  const labels = stacked || size.width >= 150 * buttons.length || !buttons.some((button) => button.glyph);
  return (
    <FlexWidget style={{ flexDirection: stacked ? "column" : "row", width: "match_parent", marginTop: stacked ? 0 : 6 }}>
      {buttons.map((button, index) => {
        const main = index === primary;
        const fg = main ? p.accentFg : p.softFg;
        const glyph = button.glyph ? BUTTON_GLYPHS[button.glyph] : null;
        return (
          <FlexWidget
            key={button.label}
            {...(button.action
              ? { clickAction: WIDGET_ACTION, clickActionData: actionData(button.action) }
              : { clickAction: "OPEN_URI", clickActionData: { uri: button.uri ?? model.uri } })}
            accessibilityLabel={button.label}
            style={{
              ...(stacked ? { width: "match_parent" as const, marginTop: index === 0 ? 0 : 6 } : { flex: 1, marginLeft: index === 0 ? 0 : 6 }),
              height: 40,
              borderRadius: 12,
              backgroundColor: main ? p.accent : p.soft,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {glyph ? <SvgWidget svg={GLYPH(glyph, fg, button.glyph === "play")} style={{ width: 16, height: 16 }} /> : null}
            {labels || !glyph ? (
              <TextWidget
                text={button.label}
                maxLines={1}
                style={{ fontSize: 13, fontWeight: "600", color: fg, marginLeft: glyph ? 6 : 0 }}
              />
            ) : null}
          </FlexWidget>
        );
      })}
    </FlexWidget>
  );
}

function Card({ model, dark, size, options }: { model: WidgetModel; dark: boolean; size: Size; options: Options }) {
  const live = !options.preview;
  const p = palette(dark);
  const roomForRows = Math.max(0, Math.floor((size.height - 40 - (model.value ? 54 : 0) - (model.buttons ? 46 : 0)) / 28));
  const rows = (model.rows ?? []).slice(0, roomForRows);
  const showBars = Boolean(model.bars?.length) && size.height >= 150;
  const alone = !rows.length && !showBars && !model.meters && !model.note && !model.buttons && !model.empty;
  const wide = size.width >= 260 && size.height < 220 && Boolean(model.value) && !model.ring && !model.meters && !model.buttons && Boolean(model.rows?.length || model.bars?.length);
  // A wide clock keeps its buttons beside the time instead of under it.
  const wideClock = size.width >= 260 && size.height < 220 && Boolean(model.timer || model.buttons?.some((button) => button.action)) && !model.rows?.length && Boolean(model.buttons?.length);
  const wideBars = wide && !model.rows?.length;
  const checks = (model.rows ?? []).some((row) => row.done !== undefined);
  const wideRows = (model.rows ?? []).slice(0, Math.max(1, Math.floor((size.height - 50) / 28)));
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
        padding: 14,
      }}
    >
      <Header model={model} p={p} />
      {wideClock ? (
        <FlexWidget style={{ flexDirection: "row", width: "match_parent", flex: 1, alignItems: "center" }}>
          <FlexWidget style={{ flexDirection: "column", flex: 1, marginRight: 12 }}>
            <Stat model={model} p={p} size={{ width: size.width / 2, height: size.height }} live={live} />
          </FlexWidget>
          <FlexWidget style={{ flexDirection: "column", width: 132 }}>
            <Buttons model={model} p={p} size={size} stacked />
          </FlexWidget>
        </FlexWidget>
      ) : wide ? (
        // A wide widget puts the figure on the left and the detail beside it,
        // so a 4x2 shows twice the rows instead of an empty right half.
        <FlexWidget style={{ flexDirection: "row", width: "match_parent", flex: 1 }}>
          <FlexWidget style={{ flexDirection: "column", width: 112, marginRight: 12 }}>
            <Stat model={model} p={p} size={size} live={live} />
          </FlexWidget>
          <FlexWidget style={{ flexDirection: "column", flex: 1 }}>
            {wideBars ? <Bars model={model} p={p} tall={Math.max(24, Math.min(140, size.height - 74))} /> : null}
            {!wideBars
              ? wideRows.map((row, index) => <Row key={`${row.title}-${index}`} row={row} p={p} fallbackUri={model.uri} checks={checks} />)
              : null}
          </FlexWidget>
        </FlexWidget>
      ) : (
        // The widget library has no Fragment, so siblings go in as a plain list.
        [
          model.ring ? <Ring key="ring" model={model} p={p} size={size} /> : null,
          // A lone figure sits at the bottom, under the title, like a clock widget.
          !model.ring && alone ? <FlexWidget key="spacer" style={{ flex: 1, width: "match_parent" }} /> : null,
          !model.ring ? <Stat key="stat" model={model} p={p} size={size} alone={alone} live={live} /> : null,
          model.meters ? <Meters key="meters" model={model} p={p} /> : null,
          showBars ? <Bars key="bars" model={model} p={p} tall={Math.max(24, Math.min(140, size.height - 140))} /> : null,
          !showBars && rows.length ? (
            <FlexWidget key="rows" style={{ flexDirection: "column", width: "match_parent" }}>
              {rows.map((row, index) => (
                <Row key={`${row.title}-${index}`} row={row} p={p} fallbackUri={model.uri} checks={checks} />
              ))}
            </FlexWidget>
          ) : null,
        ]
      )}
      {model.note ? (
        <TextWidget
          text={model.note}
          maxLines={Math.max(2, Math.floor((size.height - 80) / 18))}
          truncate="END"
          style={{ fontSize: 14, color: p.fg, lineHeight: 19 }}
        />
      ) : null}
      {model.empty && !rows.length && !model.note ? (
        <TextWidget text={model.empty} maxLines={3} style={{ fontSize: 13, color: p.muted }} />
      ) : null}
      {model.buttons?.length && !wideClock ? (
        <FlexWidget style={{ flex: 1, width: "match_parent", flexDirection: "column", justifyContent: "flex-end" }}>
          <Buttons model={model} p={p} size={size} />
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
        paddingHorizontal: prompt ? 4 : 8,
        justifyContent: "space-between",
      }}
    >
      {main ? (
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: main.uri }}
          accessibilityLabel={main.label === "Task" ? "Add a task" : main.label}
          style={{
            ...(prompt ? { flex: 1, paddingLeft: 4 } : { width: bubble + 8, justifyContent: "center" as const }),
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
          style={{ width: bubble + 8, height: "match_parent", alignItems: "center", justifyContent: "center" }}
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
