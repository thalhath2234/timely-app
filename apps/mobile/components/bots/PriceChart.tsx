import { useState } from "react";
import { Platform, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { axisMoney, formatMoney, priceDayLabels, priceDomain } from "@timely/contract/bots";
import { colors, createThemedStyleSheet } from "../../lib/theme";

// SVG text in a browser falls back to a serif face; the phone draws it in the system font.
const FONT = Platform.OS === "web" ? "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" : undefined;

const AXIS_LEFT = 40;
const AXIS_BOTTOM = 20;
const PAD_TOP = 8;
const PAD_RIGHT = 8;

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
  const { lo, hi, ticks } = priceDomain(points, threshold ?? null);
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
              {/* A card-coloured backing keeps the label readable over the fill (4.5:1). */}
              <Rect
                x={AXIS_LEFT + 1}
                y={y(threshold) - 17}
                width={Math.round(`Your line ${formatMoney(threshold, currency)}`.length * 6.2) + 6}
                height={15}
                rx={4}
                fill={colors.card}
                fillOpacity={0.92}
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
          {priceDayLabels(points).map(({ t, label: text, anchor }) => (
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
