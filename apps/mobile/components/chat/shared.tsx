import { Pressable, Text, View, ScrollView } from "react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import RichDoc from "../docs/RichDoc";
import { fromMarkdown } from "../../lib/markdown";
export function Action({
  label,
  onPress,
  disabled,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        primary && styles.primary,
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text
        style={[
          styles.actionText,
          primary && { color: colors.primaryForeground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function ChatText({
  text,
  onLink,
}: {
  text: string;
  onLink?: (href: string) => void;
}) {
  return text ? (
    <RichDoc content={fromMarkdown(text).content} onLink={onLink} />
  ) : null;
}
export function DetailValue({
  value,
  field = "",
  onLink,
}: {
  value: unknown;
  field?: string;
  onLink: (href: string) => void;
}) {
  if (value == null || value === "")
    return <Text style={styles.muted}>Empty</Text>;
  if (typeof value === "string")
    return field === "markdown" || field === "description" ? (
      <ChatText text={value} onLink={onLink} />
    ) : (
      <Text selectable style={styles.text}>
        {/^\$\d+\./.test(value)
          ? `From change ${Number(value.slice(1).split(".")[0]) + 1}`
          : value}
      </Text>
    );
  if (typeof value !== "object")
    return <Text style={styles.text}>{String(value)}</Text>;
  if (Array.isArray(value))
    return (
      <View style={styles.stack}>
        {value.map((v, i) => (
          <View key={i} style={styles.indent}>
            <DetailValue value={v} onLink={onLink} />
          </View>
        ))}
      </View>
    );
  const record = value as Record<string, unknown>;
  const columns = Array.isArray(record.columns)
    ? (record.columns as { id?: string; name?: string; type?: string }[])
    : null;
  const rows = Array.isArray(record.rows)
    ? (record.rows as { cells?: Record<string, unknown> }[])
    : null;
  return (
    <View style={styles.stack}>
      {columns && rows ? (
        <ScrollView horizontal>
          <View>
            <View style={styles.row}>
              {columns.map((col, i) => (
                <View key={i} style={styles.cell}>
                  <Text style={styles.text}>
                    {col.name || `Column ${i + 1}`}
                  </Text>
                  <Text style={styles.muted}>{col.type}</Text>
                </View>
              ))}
            </View>
            {rows.map((row, i) => (
              <View key={i} style={styles.row}>
                {columns.map((col, j) => (
                  <View key={j} style={styles.cell}>
                    <DetailValue
                      value={row.cells?.[col.id || col.name || ""]}
                      onLink={onLink}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
      {Object.entries(record)
        .filter(
          ([key]) =>
            !["id", "userId", "createdAt", "updatedAt"].includes(key) &&
            !(columns && rows && ["columns", "rows"].includes(key)),
        )
        .map(([key, val]) => (
          <View key={key} style={styles.stack}>
            <Text style={styles.muted}>
              {key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
            </Text>
            <DetailValue value={val} field={key} onLink={onLink} />
          </View>
        ))}
    </View>
  );
}
export const styles = createThemedStyleSheet(() => ({
  action: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 24,
    paddingHorizontal: 16,
    backgroundColor: colors.muted,
  },
  primary: { backgroundColor: colors.primary },
  actionText: { fontSize: 14, fontWeight: "700", color: colors.foreground },
  text: { color: colors.foreground, fontSize: 14, lineHeight: 22 },
  muted: { color: colors.mutedForeground, fontSize: 12, lineHeight: 19 },
  stack: { gap: 8 },
  indent: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: 12,
  },
  row: { flexDirection: "row" },
  cell: {
    width: 160,
    padding: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
}));
