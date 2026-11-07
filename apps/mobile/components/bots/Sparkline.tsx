import { View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { colors } from "../../lib/theme";

/**
 * A card's price line: the last 30 daily closes and now, an area under it, a
 * dot on the newest point and the rule's line dashed across in the warning
 * colour (the kit's `.chart-threshold`). Drawn by hand, as on the web.
 */
export function Sparkline({
  points,
  threshold,
  width,
  height = 34,
  tone = colors.chart1,
  summary,
}: {
  points: [number, number][];
  threshold?: number | null;
  width: number;
  height?: number;
  tone?: string;
  /** Read aloud in place of the drawing. */
  summary: string;
}) {
  if (points.length < 2 || width <= 0) return null;
  const values = points.map(([, v]) => v);
  if (threshold != null) values.push(threshold);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
  lo -= pad;
  hi += pad;
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const inset = 3;
  const x = (t: number, index: number) =>
    inset + (t1 > t0 ? (t - t0) / (t1 - t0) : index / (points.length - 1)) * (width - inset * 2);
  const y = (v: number) => inset + (1 - (v - lo) / (hi - lo)) * (height - inset * 2);
  const xy = points.map(([t, v], index) => [x(t, index), y(v)] as const);
  const line = xy.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const [endX, endY] = xy[xy.length - 1];
  const area = `${line} L${endX.toFixed(1)} ${height} L${xy[0][0].toFixed(1)} ${height} Z`;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ width, height }}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {threshold != null ? (
          <Line
            x1={0}
            x2={width}
            y1={y(threshold)}
            y2={y(threshold)}
            stroke={colors.warning}
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        ) : null}
        <Path d={area} fill={tone} fillOpacity={0.1} />
        <Path d={line} fill="none" stroke={tone} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={endX} cy={endY} r={3} fill={tone} />
      </Svg>
    </View>
  );
}
