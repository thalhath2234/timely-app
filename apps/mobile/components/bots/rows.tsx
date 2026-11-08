import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Pencil } from "lucide-react-native";
import { Field } from "../ui/primitives";
import { ListRow } from "../settings/SettingsList";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/** A grouped row with a field typed in place on the right ("Symbol  NVDA"). */
export function FieldRow({
  title,
  meta,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = "none",
  width = 180,
  suffix,
}: {
  title: string;
  meta?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad" | "url";
  autoCapitalize?: "none" | "sentences" | "words";
  width?: number;
  /** A unit after the field ("%"). */
  suffix?: string;
}) {
  return (
    <ListRow
      title={title}
      meta={meta}
      accessibilityLabel={title}
      trailing={
        <View style={[styles.inline, { width }]}>
          <View style={styles.field}>
            <Field
              bare
              align="right"
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              keyboardType={keyboardType}
              autoCapitalize={autoCapitalize}
              accessibilityLabel={title}
            />
          </View>
          {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
        </View>
      }
    />
  );
}

/** A value in a soft pill with a pencil: tap the row to change it on its own page. */
export function EditPill({ children }: { children: string }) {
  return (
    <View style={styles.pill}>
      <Text numberOfLines={1} style={styles.pillText}>
        {children}
      </Text>
      {/* Its own box, so a long value never squeezes the pencil smaller. */}
      <View style={styles.pencil}>
        <Pencil size={14} color={colors.mutedForeground} />
      </View>
    </View>
  );
}

/** A 32 px soft tile for a row's icon (the snooze rows, a new watch's kind). */
export function IconTile({ children }: { children: ReactNode }) {
  return <View style={styles.tile}>{children}</View>;
}

const styles = createThemedStyleSheet((colors) => ({
  inline: { flexDirection: "row", alignItems: "center", gap: 4 },
  field: { flex: 1, minWidth: 0 },
  suffix: { color: colors.mutedForeground, fontSize: 15, fontWeight: "500" },
  pill: {
    height: 32,
    maxWidth: 170,
    borderRadius: 10,
    backgroundColor: colors.muted,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pencil: { flexShrink: 0 },
  pillText: { flexShrink: 1, color: colors.foreground, fontSize: 14, fontWeight: "500", fontVariant: ["tabular-nums"] },
  tile: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
}));
