import { useState } from "react";
import { Platform, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import { formatMoney, shortDate } from "@timely/contract/bots";
import { colors, createThemedStyleSheet } from "../../lib/theme";

// SVG text in a browser falls back to a serif face; the phone draws it in the system font.
const FONT = Platform.OS === "web" ? "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" : undefined;

const AXIS_LEFT = 40;
const AXIS_BOTTOM = 20;
const PAD_TOP = 8;
const PAD_RIGHT = 8;

/** "₹30k", "₹27.5k", "$68.4k", "$182": an axis label, short. Same as the web. */
export function axisMoney(v: number, currency: string): string {
  const unit = formatMoney(1, currency);
  const before = unit.startsWith("1") ? "" : unit.slice(0, unit.indexOf("1"));
  const after = unit.startsWith("1") ? unit.slice(1) : "";
  const a = Math.abs(v);
  let n: string;
  if (a >= 1_000_000) n = `${Number((a / 1_000_000).toFixed(1))}M`;
  else if (a >= 1000) n = `${Number((a / 1000).toFixed(1))}k`;
  else n = `${Number(a.toFixed(a < 10 ? 2 : 0))}`;
  return `${v < 0 ? "-" : ""}${before}${n}${after}`;
}

/** Round gridline values inside [lo, hi]: two to four of them. */
function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const power = 10 ** Math.floor(Math.log10(span / 2));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * power).find((s) => span / s <= 3) ?? 10 * power;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  return ticks;
}

/**
 * A price watch's last 30 days, as the web rail draws it: daily closes as a
 * line over a soft area, the rule's line dashed and labelled ("Your line
 * ₹25,000"), the low point and the newest point marked, gridlines and first /
 * middle / Today under it. It takes the width its box is given (onLayout), so
 * it fits a 360 px phone.
 */
export function PriceChart({
  points,
  threshold,
  currency,
  height = 130,
}: {
  /** [unixSeconds, price], oldest first. */
  points: [number, number][];
  threshold?: number | null;
  currency: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  if (points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>The line fills in after a few days of checks</Text>
      </View>
    );
  }
  const values = points.map(([, v]) => v);
  if (threshold != null) values.push(threshold);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const ticks = niceTicks(lo, hi);
  const plotW = Math.max(0, width - AXIS_LEFT - PAD_RIGHT);
  const plotH = Math.max(0, height - AXIS_BOTTOM - PAD_TOP);
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const x = (t: number) => AXIS_LEFT + (t1 > t0 ? ((t - t0) / (t1 - t0)) * plotW : plotW / 2);
  const y = (v: number) => PAD_TOP + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const line = points.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const base = PAD_TOP + plotH;
  const area = `${line} L${x(t1).toFixed(1)} ${base} L${x(t0).toFixed(1)} ${base} Z`;
  let low = 0;
  points.forEach(([, v], i) => {
    if (v < points[low][1]) low = i;
  });
  const last = points.length - 1;
  const day = (t: number) => shortDate(new Date(t * 1000).toISOString());
  const mid = points[Math.floor(last / 2)][0];
  const label = `Price over the last ${points.length} readings, from ${formatMoney(points[0][1], currency)} to ${formatMoney(points[last][1], currency)}; lowest ${formatMoney(points[low][1], currency)}`;
  // The low point's label goes on whichever side has room.
  const lowX = x(points[low][0]);
  const lowRight = lowX < AXIS_LEFT + plotW - 64;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ height }}
      onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {ticks.map((tick) => (
            <Line key={`g${tick}`} x1={AXIS_LEFT} x2={AXIS_LEFT + plotW} y1={y(tick)} y2={y(tick)} stroke={colors.border} strokeWidth={1} />
          ))}
          {ticks.map((tick) => (
            <SvgText fontFamily={FONT} key={`t${tick}`} x={AXIS_LEFT - 6} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill={colors.mutedForeground}>
              {axisMoney(tick, currency)}
            </SvgText>
          ))}
          <Path d={area} fill={colors.chart1} fillOpacity={0.1} />
          {threshold != null ? (
            <>
              <Line
                x1={AXIS_LEFT}
                x2={AXIS_LEFT + plotW}
                y1={y(threshold)}
                y2={y(threshold)}
                stroke={colors.warning}
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
              <SvgText fontFamily={FONT} x={AXIS_LEFT + 4} y={y(threshold) - 5} fontSize={11} fontWeight="500" fill={colors.warningText}>
                {`Your line ${formatMoney(threshold, currency)}`}
              </SvgText>
            </>
          ) : null}
          <Path d={line} fill="none" stroke={colors.chart1} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          {low !== last ? (
            <>
              <Circle cx={lowX} cy={y(points[low][1])} r={3.5} fill={colors.chart1} stroke={colors.card} strokeWidth={2} />
              <SvgText
                fontFamily={FONT}
                x={lowRight ? lowX + 6 : lowX - 6}
                y={y(points[low][1]) - 6}
                textAnchor={lowRight ? "start" : "end"}
                fontSize={11}
                fontWeight="600"
                fill={colors.foreground}
              >
                {formatMoney(points[low][1], currency)}
              </SvgText>
            </>
          ) : null}
          <Circle cx={x(t1)} cy={y(points[last][1])} r={3.5} fill={colors.chart1} stroke={colors.card} strokeWidth={2} />
          {(
            [
              [t0, day(t0), "start"],
              [mid, day(mid), "middle"],
              [t1, "Today", "end"],
            ] as const
          ).map(([t, text, anchor]) => (
            <SvgText fontFamily={FONT} key={anchor} x={x(t)} y={height - 4} textAnchor={anchor} fontSize={10} fill={colors.mutedForeground}>
              {text}
            </SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  empty: { height: 72, borderRadius: 10, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  emptyText: { color: colors.mutedForeground, fontSize: 12, textAlign: "center" },
}));
