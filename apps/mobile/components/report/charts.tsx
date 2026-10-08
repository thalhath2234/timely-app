import { useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import { formatMetric, type CardUnit, type SeriesPoint } from "@timely/contract/dashboard";
import { chartGridColor, seriesColor } from "../../lib/dashboard";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/** A clean axis maximum: 1, 2, 2.5, 5 or 10 times a power of ten. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

function useWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
  };
  return [width, onLayout] as const;
}

/** The tapped point's value, or the chart's hint when nothing is picked. */
function Readout({ point, unit, hint }: { point: SeriesPoint | null; unit: CardUnit; hint: string }) {
  return (
    <Text style={styles.readout} numberOfLines={1}>
      {point ? `${point.detail ?? point.label}: ${formatMetric(point.value, unit)}` : hint}
    </Text>
  );
}

/** Horizontal bars with the label above and the value at the right, so long names never get cut. */
export function CategoryBars({ points, unit, color }: { points: SeriesPoint[]; unit: CardUnit; color: number }) {
  const max = Math.max(...points.map((point) => point.value), 0) || 1;
  return (
    <View style={{ gap: 10 }}>
      {points.map((point) => (
        <View key={point.key}>
          <View style={styles.barHead}>
            <Text style={styles.barLabel} numberOfLines={1}>
              {point.label}
            </Text>
            <Text style={styles.value}>{formatMetric(point.value, unit)}</Text>
          </View>
          <View
            style={[
              styles.bar,
              {
                width: `${Math.max((point.value / max) * 100, point.value > 0 ? 2 : 0)}%`,
                backgroundColor: seriesColor(point.other ? 8 : color, point.other),
                minWidth: point.value > 0 ? 4 : 0,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const AXIS_LEFT = 32;
const AXIS_BOTTOM = 18;
const PAD_TOP = 10;
const PAD_RIGHT = 8;
const PLOT_HEIGHT = 150;

function labelStride(count: number, width: number) {
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(width / 48))));
}

function Axis({ width, max, unit }: { width: number; max: number; unit: CardUnit }) {
  return (
    <>
      {[0, 0.5, 1].map((tick) => {
        const y = PAD_TOP + PLOT_HEIGHT - tick * PLOT_HEIGHT;
        return (
          <Line key={`grid-${tick}`} x1={AXIS_LEFT} x2={width - PAD_RIGHT} y1={y} y2={y} stroke={chartGridColor()} strokeWidth={1} />
        );
      })}
      {[0, 0.5, 1].map((tick) => (
        <SvgText
          key={`tick-${tick}`}
          x={AXIS_LEFT - 6}
          y={PAD_TOP + PLOT_HEIGHT - tick * PLOT_HEIGHT + 3}
          fontSize={10}
          textAnchor="end"
          fill={colors.mutedForeground}
        >
          {formatMetric(max * tick, unit)}
        </SvgText>
      ))}
    </>
  );
}

/** Picks the point under a tap on the plot. */
function pickIndex(x: number, width: number, count: number) {
  const plotW = width - AXIS_LEFT - PAD_RIGHT;
  if (count === 0 || plotW <= 0) return null;
  return Math.max(0, Math.min(count - 1, Math.floor(((x - AXIS_LEFT) / plotW) * count)));
}

/** Columns over time: one baseline, 4px rounded tops. Tap a column for its value. */
export function ColumnChart({ points, unit, color }: { points: SeriesPoint[]; unit: CardUnit; color: number }) {
  const [width, onLayout] = useWidth();
  const [picked, setPicked] = useState<number | null>(null);
  const plotW = Math.max(0, width - AXIS_LEFT - PAD_RIGHT);
  const max = niceMax(Math.max(...points.map((point) => point.value), 0));
  const band = points.length ? plotW / points.length : 0;
  const barW = Math.min(24, Math.max(2, band - 2));
  const stride = labelStride(points.length, plotW);
  const height = PAD_TOP + PLOT_HEIGHT + AXIS_BOTTOM;
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <View>
      <Readout point={picked === null ? null : points[picked]} unit={unit} hint={`${formatMetric(total, unit)} in total · tap a column`} />
      <Pressable onLayout={onLayout} onPress={(event) => setPicked(pickIndex(event.nativeEvent.locationX, width, points.length))}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Axis width={width} max={max} unit={unit} />
            {points.map((point, index) => {
              const h = (point.value / max) * PLOT_HEIGHT;
              const x = AXIS_LEFT + index * band + (band - barW) / 2;
              const y = PAD_TOP + PLOT_HEIGHT - h;
              const r = Math.min(4, barW / 2, h);
              const base = PAD_TOP + PLOT_HEIGHT;
              return (
                <G key={point.key}>
                  {h > 0 ? (
                    <Path
                      d={`M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${base} Z`}
                      fill={seriesColor(point.other ? 8 : color, point.other)}
                      opacity={picked === null || picked === index ? 1 : 0.55}
                    />
                  ) : null}
                  {index % stride === 0 ? (
                    <SvgText x={AXIS_LEFT + index * band + band / 2} y={height - 4} fontSize={10} textAnchor="middle" fill={colors.mutedForeground}>
                      {point.label}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
          </Svg>
        ) : (
          <View style={{ height }} />
        )}
      </Pressable>
    </View>
  );
}

/** A 2px line over time with a dot on the picked point. */
export function LineChart({ points, unit, color }: { points: SeriesPoint[]; unit: CardUnit; color: number }) {
  const [width, onLayout] = useWidth();
  const [picked, setPicked] = useState<number | null>(null);
  const plotW = Math.max(0, width - AXIS_LEFT - PAD_RIGHT);
  const max = niceMax(Math.max(...points.map((point) => point.value), 0));
  const height = PAD_TOP + PLOT_HEIGHT + AXIS_BOTTOM;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const xAt = (index: number) => AXIS_LEFT + (points.length > 1 ? index * step : plotW / 2);
  const yAt = (value: number) => PAD_TOP + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index)},${yAt(point.value)}`).join(" ");
  const stride = labelStride(points.length, plotW);
  const stroke = seriesColor(color);
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <View>
      <Readout point={picked === null ? null : points[picked]} unit={unit} hint={`${formatMetric(total, unit)} in total · tap the chart`} />
      <Pressable
        onLayout={onLayout}
        onPress={(event) => {
          if (points.length < 2) return setPicked(points.length ? 0 : null);
          const x = event.nativeEvent.locationX;
          setPicked(Math.max(0, Math.min(points.length - 1, Math.round((x - AXIS_LEFT) / step))));
        }}
      >
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Axis width={width} max={max} unit={unit} />
            {path ? <Path d={path} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
            {picked !== null && points[picked] ? (
              <>
                <Line x1={xAt(picked)} x2={xAt(picked)} y1={PAD_TOP} y2={PAD_TOP + PLOT_HEIGHT} stroke={colors.mutedForeground} strokeWidth={1} opacity={0.4} />
                <Circle cx={xAt(picked)} cy={yAt(points[picked].value)} r={5} fill={stroke} stroke={colors.card} strokeWidth={2} />
              </>
            ) : null}
            {points.map((point, index) =>
              index % stride === 0 ? (
                <SvgText key={point.key} x={xAt(index)} y={height - 4} fontSize={10} textAnchor="middle" fill={colors.mutedForeground}>
                  {point.label}
                </SvgText>
              ) : null,
            )}
          </Svg>
        ) : (
          <View style={{ height }} />
        )}
      </Pressable>
    </View>
  );
}

function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number) {
  const sweep = Math.min(end - start, Math.PI * 2 - 0.0001);
  const finish = start + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const point = (radius: number, angle: number) => `${cx + radius * Math.sin(angle)},${cy - radius * Math.cos(angle)}`;
  return [
    `M${point(outer, start)}`,
    `A${outer},${outer} 0 ${large} 1 ${point(outer, finish)}`,
    `L${point(inner, finish)}`,
    `A${inner},${inner} 0 ${large} 0 ${point(inner, start)}`,
    "Z",
  ].join(" ");
}

function donutArcs(points: SeriesPoint[], total: number) {
  const gap = points.filter((point) => point.value > 0).length > 1 ? 0.02 : 0;
  let angle = 0;
  return points.map((point, index) => {
    const sweep = total > 0 ? (point.value / total) * Math.PI * 2 : 0;
    const arc = { point, index, start: angle + gap / 2, end: angle + sweep - gap / 2 };
    angle += sweep;
    return arc;
  });
}

/** A donut with the total in the middle and a legend that carries every value. */
export function DonutChart({ points, unit, total }: { points: SeriesPoint[]; unit: CardUnit; total: number }) {
  const size = 132;
  const outer = size / 2;
  const inner = outer - 16;
  const arcs = donutArcs(points, total);
  return (
    <View style={styles.donutRow}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {total > 0 ? (
            arcs.map((arc) =>
              arc.end > arc.start ? (
                <Path key={arc.point.key} d={arcPath(outer, outer, outer, inner, arc.start, arc.end)} fill={seriesColor(arc.index, arc.point.other)} />
              ) : null,
            )
          ) : (
            <Circle cx={outer} cy={outer} r={(outer + inner) / 2} stroke={colors.muted} strokeWidth={16} fill="none" />
          )}
        </Svg>
        <View style={styles.donutCenter} pointerEvents="none">
          <Text style={styles.donutTotal}>{formatMetric(total, unit)}</Text>
          <Text style={styles.muted}>total</Text>
        </View>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        {points.map((point, index) => (
          <View key={point.key} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: seriesColor(index, point.other) }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {point.label}
            </Text>
            <Text style={styles.value}>
              {formatMetric(point.value, unit)}
              {total > 0 ? ` · ${Math.round((point.value / total) * 100)}%` : ""}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A thin progress track. `color` is a series index or a colour string. */
export function Meter({ value, color }: { value: number; color: number | string }) {
  const share = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.track}>
      <View
        style={[
          styles.fill,
          { width: `${share * 100}%`, backgroundColor: typeof color === "number" ? seriesColor(color) : color },
        ]}
      />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  readout: { color: colors.mutedForeground, fontSize: 12, marginBottom: 6, fontVariant: ["tabular-nums"] },
  barHead: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginBottom: 4 },
  barLabel: { flex: 1, color: colors.foreground, fontSize: 13 },
  value: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  bar: { height: 8, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  donutCenter: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  donutTotal: { color: colors.foreground, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  muted: { color: colors.mutedForeground, fontSize: 11 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { flex: 1, color: colors.foreground, fontSize: 13 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
}));
