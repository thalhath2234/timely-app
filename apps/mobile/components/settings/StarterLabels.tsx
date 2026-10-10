import { useState } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Chip } from "../ui/primitives";
import { keys, useDecisionFeedback, useStarterLabelsQuery } from "../../lib/hooks";
import { applyStarterLabels } from "../../lib/api/decisions";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/** Labels smart suggestions think this workspace is missing (phone),
 * picked from a starter catalog by what the person uses Timely for and the
 * work already in it. Nothing shows while suggestions are off. */
export default function StarterLabels({ workspaceId }: { workspaceId: string }) {
  const { data } = useStarterLabelsQuery(workspaceId);
  const feedback = useDecisionFeedback();
  const client = useQueryClient();
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!data?.available || hidden || data.labels.length === 0) return null;
  const chosen = data.labels.filter((label) => !unpicked.has(label.name));

  const add = async () => {
    if (!chosen.length) return;
    setSaving(true);
    try {
      const result = await applyStarterLabels(workspaceId, chosen);
      if (data.logId) feedback.mutate({ logId: data.logId, accepted: true });
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.workspaces }),
        client.invalidateQueries({ queryKey: ["starter-labels"] }),
      ]);
      const made = result.created.length;
      const skipped = result.skipped.length;
      useToastStore
        .getState()
        .show(`Added ${made} label${made === 1 ? "" : "s"}${skipped ? `; ${skipped} already used elsewhere` : ""}`);
      setHidden(true);
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not add labels");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card} testID="starter-labels">
      <View style={styles.header}>
        <Sparkles size={14} color={colors.primary} />
        <Text style={styles.title}>Labels that may help here</Text>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}
          onPress={() => {
            if (data.logId) feedback.mutate({ logId: data.logId, accepted: false });
            setHidden(true);
          }}
        >
          <X size={14} color={colors.mutedForeground} />
        </AnimatedPressable>
      </View>
      <View style={styles.chips}>
        {data.labels.map((label) => (
          <Chip
            key={label.name}
            label={label.name}
            color={label.color}
            active={!unpicked.has(label.name)}
            onPress={() =>
              setUnpicked((prev) => {
                const next = new Set(prev);
                if (next.has(label.name)) next.delete(label.name);
                else next.add(label.name);
                return next;
              })
            }
          />
        ))}
      </View>
      <AnimatedPressable
        accessibilityRole="button"
        disabled={saving || !chosen.length}
        onPress={() => void add()}
        style={[styles.button, (saving || !chosen.length) && { opacity: 0.5 }]}
      >
        <Text style={styles.buttonText}>{saving ? "Adding…" : `Add ${chosen.length}`}</Text>
      </AnimatedPressable>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  buttonText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
}));
