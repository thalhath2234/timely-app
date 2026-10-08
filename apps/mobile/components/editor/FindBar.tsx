import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronDown, ChevronUp, X } from "lucide-react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/** Find and replace over the doc editor; the editor page does the search
 * (the find* commands in editorHtml.ts) and reports `result`. */
export default function FindBar({
  run,
  result,
  onClose,
}: {
  run: (name: string, payload?: Record<string, unknown>) => void;
  result: { current: number; count: number };
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);

  useEffect(() => {
    run("find", { query, caseSensitive });
  }, [query, caseSensitive, run]);
  useEffect(() => () => run("find", { query: "" }), [run]);

  const count = query ? result.count : 0;
  return (
    <View style={styles.bar} accessibilityRole="search">
      <View style={styles.row}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Find"
          placeholderTextColor={colors.mutedForeground}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          submitBehavior="submit"
          onSubmitEditing={() => run("findStep", { direction: 1 })}
          style={styles.input}
        />
        <Text style={styles.count}>{query ? (count ? `${result.current + 1}/${count}` : "None") : ""}</Text>
        <Pressable accessibilityLabel="Match case" accessibilityState={{ selected: caseSensitive }} onPress={() => setCaseSensitive((value) => !value)} style={[styles.icon, caseSensitive && styles.iconOn]} hitSlop={4}>
          <Text style={styles.aa}>Aa</Text>
        </Pressable>
        <Pressable accessibilityLabel="Previous match" disabled={!count} onPress={() => run("findStep", { direction: -1 })} style={styles.icon} hitSlop={4}>
          <ChevronUp size={18} color={count ? colors.foreground : colors.mutedForeground} />
        </Pressable>
        <Pressable accessibilityLabel="Next match" disabled={!count} onPress={() => run("findStep", { direction: 1 })} style={styles.icon} hitSlop={4}>
          <ChevronDown size={18} color={count ? colors.foreground : colors.mutedForeground} />
        </Pressable>
        <Pressable accessibilityLabel="Close find" onPress={onClose} style={styles.icon} hitSlop={4}>
          <X size={18} color={colors.foreground} />
        </Pressable>
      </View>
      <View style={styles.row}>
        <TextInput
          value={replacement}
          onChangeText={setReplacement}
          placeholder="Replace with"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Pressable disabled={!count} onPress={() => run("replaceCurrent", { text: replacement })} style={[styles.button, !count && styles.disabled]}>
          <Text style={styles.buttonText}>Replace</Text>
        </Pressable>
        <Pressable disabled={!count} onPress={() => run("replaceAll", { text: replacement })} style={[styles.button, !count && styles.disabled]}>
          <Text style={styles.buttonText}>All</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  bar: { gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  input: { flex: 1, minWidth: 0, height: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground, fontSize: 15 },
  count: { minWidth: 40, textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  icon: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  iconOn: { backgroundColor: colors.accent },
  aa: { color: colors.foreground, fontSize: 13, fontWeight: "700" },
  button: { height: 36, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.4 },
}));
