import { useState } from "react";
import { Text, View } from "react-native";
import { ArrowLeftRight, Sparkles, X } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import type { ConfirmRequest } from "../ui/ConfirmSheet";
import { useCleanupSuggestionsQuery, useDecisionFeedback, useMergeTaxonomy } from "../../lib/hooks";
import type { CleanupMerge } from "../../lib/api/decisions";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";

const nouns = { label: "label", status: "status", option: "option" } as const;

function uses(n: number) {
  return `${n} use${n === 1 ? "" : "s"}`;
}

/** Labels, statuses or select options smart suggestions think mean the same
 * thing (phone), with a merge that moves every task, project and saved view
 * over to the kept one after a confirm. Nothing shows while suggestions are
 * off or find no pair. */
export default function CleanupSuggestions({
  workspaceId,
  kind,
  confirm,
}: {
  workspaceId: string;
  kind: CleanupMerge["kind"];
  confirm: (request: ConfirmRequest) => void;
}) {
  const { data } = useCleanupSuggestionsQuery(workspaceId);
  const merge = useMergeTaxonomy(workspaceId);
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [swapped, setSwapped] = useState<Set<string>>(new Set());
  if (!data?.available) return null;

  const keyOf = (m: CleanupMerge) => `${m.fieldId ?? ""}:${m.from.id}:${m.into.id}`;
  const merges = data.merges.filter((m) => m.kind === kind && !hidden.has(keyOf(m)));
  if (merges.length === 0) return null;
  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));
  const toast = (message: string) => useToastStore.getState().show(message);

  return (
    <View style={styles.card} testID={`cleanup-suggestions-${kind}`}>
      <View style={styles.header}>
        <Sparkles size={14} color={colors.primary} />
        <Text style={styles.title}>Look like the same {nouns[kind]}</Text>
      </View>
      {merges.map((suggested) => {
        const key = keyOf(suggested);
        const m = swapped.has(key) ? { ...suggested, from: suggested.into, into: suggested.from } : suggested;
        return (
          <View key={key} style={styles.row}>
            <Text style={styles.text}>
              Merge <Text style={styles.strong}>{m.from.name}</Text> ({uses(m.from.uses)}) into{" "}
              <Text style={styles.strong}>{m.into.name}</Text> ({uses(m.into.uses)})
              {m.fieldName ? ` in ${m.fieldName}` : ""}
            </Text>
            <View style={styles.actions}>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel="Swap which one is kept"
                hitSlop={8}
                onPress={() =>
                  setSwapped((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                style={styles.icon}
              >
                <ArrowLeftRight size={14} color={colors.mutedForeground} />
              </AnimatedPressable>
              <AnimatedPressable
                accessibilityRole="button"
                disabled={merge.isPending}
                onPress={() =>
                  confirm({
                    title: `Merge “${m.from.name}” into “${m.into.name}”?`,
                    message: `Everything using “${m.from.name}” switches to “${m.into.name}”, including saved views, and “${m.from.name}” is deleted. This cannot be undone.`,
                    confirmLabel: "Merge",
                    onConfirm: async () => {
                      try {
                        const result = await merge.mutateAsync(m);
                        if (data.logId) feedback.mutate({ logId: data.logId, accepted: true });
                        hide(key);
                        const moved = result.tasks + result.projects;
                        toast(`Merged into “${m.into.name}”${moved ? `, ${moved} item${moved === 1 ? "" : "s"} updated` : ""}`);
                      } catch (error) {
                        toast(error instanceof Error ? error.message : "Could not merge");
                      }
                    },
                  })
                }
                style={[styles.button, merge.isPending && { opacity: 0.5 }]}
              >
                <Text style={styles.buttonText}>Merge</Text>
              </AnimatedPressable>
              <AnimatedPressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} onPress={() => hide(key)} style={styles.icon}>
                <X size={14} color={colors.mutedForeground} />
              </AnimatedPressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  strong: { color: colors.foreground, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  icon: { padding: 4 },
  button: { minHeight: 32, borderRadius: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
  buttonText: { color: colors.foreground, fontSize: 12, fontWeight: "700" },
}));
