import { Text, View } from "react-native";
import { stripLegend, stripMarks, stripSummary, type StripMark } from "@timely/contract/bots";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { quietGrey } from "./tone";

// "No change" is a short grey bar; the shape carries the meaning as well as
// the colour: changed is hollow, told you and failed are full height, offline
// is a low dot. The same marks as the web.
const SIZES = {
  sm: { gap: 2, w: 4, n: 8, c: 13, full: 16, o: 4, ring: 1.25 },
  big: { gap: 3, w: 6, n: 11, c: 18, full: 22, o: 5, ring: 1.5 },
} as const;

function Mark({ mark, size }: { mark: StripMark; size: keyof typeof SIZES }) {
  const s = SIZES[size];
  const base = { width: s.w, borderRadius: 1.5 };
  switch (mark) {
    case "c":
      return <View style={[base, { height: s.c, borderWidth: s.ring, borderColor: colors.primary }]} />;
    case "f":
      return <View style={[base, { height: s.full, backgroundColor: colors.primary }]} />;
    case "x":
      return <View style={[base, { height: s.full, backgroundColor: colors.destructive }]} />;
    case "o":
      return <View style={[base, { height: s.o, borderRadius: 2, backgroundColor: quietGrey() }]} />;
    default:
      return <View style={[base, { height: s.n, backgroundColor: quietGrey() }]} />;
  }
}

/**
 * One mark per check, oldest on the left: a card's row of checks and the
 * sheet's big strip. `count` keeps only the newest marks.
 */
export function CheckStrip({
  marks,
  size = "sm",
  count,
  legend,
}: {
  marks: string | null | undefined;
  size?: "sm" | "big";
  count?: number;
  legend?: boolean;
}) {
  const shown = stripMarks(marks ?? "", count);
  if (shown.length === 0 && !legend) return null;
  const s = SIZES[size];
  const strip = (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={stripSummary(shown.join(""))}
      style={[styles.strip, { gap: s.gap, height: s.full }]}
    >
      {shown.map((mark, index) => (
        <Mark key={index} mark={mark} size={size} />
      ))}
    </View>
  );
  if (!legend) return strip;
  return (
    <View style={styles.withLegend}>
      {shown.length ? strip : null}
      <View style={styles.legend}>
        {stripLegend().map(({ mark, label }) => (
          <View key={mark} style={styles.legendItem}>
            <View style={styles.legendMark}>
              <Mark mark={mark} size="sm" />
            </View>
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  strip: { flexDirection: "row", alignItems: "flex-end", flexShrink: 0 },
  withLegend: { gap: 12 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendMark: { height: 16, justifyContent: "flex-end" },
  legendText: { color: colors.mutedForeground, fontSize: 12 },
}));
