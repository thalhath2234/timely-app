"use no memo";
import { FlexWidget, SvgWidget, TextWidget, type ColorProp } from "react-native-android-widget";
import { darkColors, lightColors, type ColorTokens } from "@timely/contract/designTokens";
import type { WidgetModel, WidgetRow, WidgetTone } from "./model";

/**
 * Draws a WidgetModel as an Android home screen widget, in Timely's light and
 * dark colours (the launcher picks one with the system theme). Layout follows
 * the widget's size: a 2x2 shows the figure and a line, taller ones add rows,
 * bars or meters.
 */

type Hex = `#${string}`;
type Size = { width: number; height: number };

const DISPLAY_FONT = "Archivo-CondensedExtraBold";

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

function Stat({ model, p, size, alone }: { model: WidgetModel; p: Palette; size: Size; alone?: boolean }) {
  if (!model.value && !model.caption) return null;
  const big = size.height >= 110 && size.width >= 110;
  // A figure with nothing under it grows with the widget instead of leaving it empty.
  const figure = alone ? Math.max(34, Math.min(64, Math.round(Math.min(size.width, size.height) * 0.3))) : big ? 34 : 24;
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent", marginBottom: 6 }}>
      {model.value ? (
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

function Row({ row, p, fallbackUri }: { row: WidgetRow; p: Palette; fallbackUri: string }) {
  const bar = isHex(row.color) ? row.color : row.tone === "accent" ? p.accent : p.soft;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: row.uri ?? fallbackUri }}
      style={{ flexDirection: "row", alignItems: "center", width: "match_parent", height: 26 }}
    >
      {row.done !== undefined ? (
        <FlexWidget
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: row.done ? 0 : 1.5,
            borderColor: p.muted,
            backgroundColor: row.done ? p.success : p.bg,
            marginRight: 8,
          }}
        />
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

function Buttons({ model, p }: { model: WidgetModel; p: Palette }) {
  return (
    <FlexWidget style={{ flexDirection: "row", width: "match_parent", marginTop: 6 }}>
      {(model.buttons ?? []).map((button, index) => (
        <FlexWidget
          key={button.label}
          clickAction="OPEN_URI"
          clickActionData={{ uri: button.uri }}
          style={{
            flex: 1,
            height: 34,
            borderRadius: 12,
            backgroundColor: index === 0 ? p.accent : p.soft,
            alignItems: "center",
            justifyContent: "center",
            marginLeft: index === 0 ? 0 : 6,
          }}
        >
          <TextWidget text={button.label} style={{ fontSize: 13, fontWeight: "600", color: index === 0 ? p.accentFg : p.softFg }} />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

function Card({ model, dark, size }: { model: WidgetModel; dark: boolean; size: Size }) {
  const p = palette(dark);
  const roomForRows = Math.max(0, Math.floor((size.height - 40 - (model.value ? 54 : 0) - (model.buttons ? 40 : 0)) / 26));
  const rows = (model.rows ?? []).slice(0, roomForRows);
  const showBars = Boolean(model.bars?.length) && size.height >= 150;
  const alone = !rows.length && !showBars && !model.meters && !model.note && !model.buttons && !model.empty;
  const wide = size.width >= 260 && size.height < 220 && Boolean(model.value) && !model.ring && !model.meters && !model.buttons && Boolean(model.rows?.length || model.bars?.length);
  const wideBars = wide && !model.rows?.length;
  const wideRows = (model.rows ?? []).slice(0, Math.max(1, Math.floor((size.height - 50) / 26)));
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
      {wide ? (
        // A wide widget puts the figure on the left and the detail beside it,
        // so a 4x2 shows twice the rows instead of an empty right half.
        <FlexWidget style={{ flexDirection: "row", width: "match_parent", flex: 1 }}>
          <FlexWidget style={{ flexDirection: "column", width: 112, marginRight: 12 }}>
            <Stat model={model} p={p} size={size} />
          </FlexWidget>
          <FlexWidget style={{ flexDirection: "column", flex: 1 }}>
            {wideBars ? <Bars model={model} p={p} tall={Math.max(24, Math.min(140, size.height - 74))} /> : null}
            {!wideBars
              ? wideRows.map((row, index) => <Row key={`${row.title}-${index}`} row={row} p={p} fallbackUri={model.uri} />)
              : null}
          </FlexWidget>
        </FlexWidget>
      ) : (
        <>
          {model.ring ? (
            <Ring model={model} p={p} size={size} />
          ) : (
            <>
              {/* A lone figure sits at the bottom, under the title, like a clock widget. */}
              {alone ? <FlexWidget style={{ flex: 1, width: "match_parent" }} /> : null}
              <Stat model={model} p={p} size={size} alone={alone} />
            </>
          )}
          {model.meters ? <Meters model={model} p={p} /> : null}
          {showBars ? <Bars model={model} p={p} tall={Math.max(24, Math.min(140, size.height - 140))} /> : null}
          {!showBars && rows.length ? (
            <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
              {rows.map((row, index) => (
                <Row key={`${row.title}-${index}`} row={row} p={p} fallbackUri={model.uri} />
              ))}
            </FlexWidget>
          ) : null}
        </>
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
      {model.buttons?.length ? (
        <FlexWidget style={{ flex: 1, width: "match_parent", flexDirection: "column", justifyContent: "flex-end" }}>
          <Buttons model={model} p={p} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

export function renderCard(model: WidgetModel, size: Size) {
  return { light: <Card model={model} dark={false} size={size} />, dark: <Card model={model} dark size={size} /> };
}

export type QuickAddButton = { label: string; uri: string; glyph: string };

const GLYPH = (paths: string[], color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths
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

function QuickAdd({ buttons, dark, size }: { buttons: QuickAddButton[]; dark: boolean; size: Size }) {
  const p = palette(dark);
  const labels = size.width >= 300;
  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: p.bg,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: p.border,
        paddingHorizontal: 8,
      }}
    >
      {buttons.map((button, index) => (
        <FlexWidget
          key={button.label}
          clickAction="OPEN_URI"
          clickActionData={{ uri: button.uri }}
          accessibilityLabel={button.label}
          style={{
            flex: 1,
            height: "match_parent",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            marginVertical: 6,
            marginHorizontal: 3,
            borderRadius: 14,
            backgroundColor: index === 0 ? p.accent : p.soft,
          }}
        >
          <SvgWidget svg={GLYPH(QUICK_ADD_GLYPHS[button.glyph] ?? [], index === 0 ? p.accentFg : p.softFg)} style={{ width: 18, height: 18 }} />
          {labels ? (
            <TextWidget
              text={button.label}
              maxLines={1}
              style={{ fontSize: 12, fontWeight: "600", color: index === 0 ? p.accentFg : p.softFg, marginLeft: 6 }}
            />
          ) : null}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

export function renderQuickAdd(buttons: QuickAddButton[], size: Size) {
  return { light: <QuickAdd buttons={buttons} dark={false} size={size} />, dark: <QuickAdd buttons={buttons} dark size={size} /> };
}
