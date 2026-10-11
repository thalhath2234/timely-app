import { useState, type ReactNode } from "react";
import { ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { ArrowUpRight, Check, Link2 } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import { SectionLabel } from "../ui/primitives";
import { useRelatedQuery } from "../../lib/hooks";
import type { RelatedItem, RelatedKind } from "../../lib/api/search";
import { hrefFor } from "../../lib/searchRoutes";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { searchKindIcon } from "./kindIcon";

/**
 * Items Smart suggestions find related to this one. Renders nothing while
 * loading, when there are none, or when Smart suggestions are off.
 *
 * `variant="chips"` is a single horizontal strip for screens whose body is
 * a full-height editor (docs); the default is a stack of rows.
 */
export default function RelatedList({
  kind,
  id,
  heading,
  style,
  variant = "rows",
  onLink,
}: {
  kind: RelatedKind;
  id: string | undefined;
  /** Replaces the default "Related" section label. */
  heading?: ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: "rows" | "chips";
  /** Shown on related docs as "Add link" (a mention in this doc), as on web. */
  onLink?: (item: RelatedItem) => void;
}) {
  const router = useRouter();
  const items = useRelatedQuery(kind, id).data ?? [];
  const [linked, setLinked] = useState<Set<string>>(() => new Set());
  if (items.length === 0) return null;

  if (variant === "chips") {
    return (
      <View style={[styles.chipsWrap, style]}>
        <Text style={styles.chipsHeading}>Related</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.chipsScroll} contentContainerStyle={styles.chips}>
          {items.map((item) => {
            const Icon = searchKindIcon(item.kind);
            return (
              <View key={`${item.kind}:${item.id}`} style={styles.chipGroup}>
                <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Open ${item.kind}: ${item.title || "Untitled"}`}
                  onPress={() => router.push(hrefFor(item.kind, item.id))} style={styles.chip}>
                  <Icon size={13} color={colors.primary} />
                  <Text numberOfLines={1} style={styles.chipText}>{item.title || "Untitled"}</Text>
                </AnimatedPressable>
                {onLink && item.kind === "doc" ? (
                  linked.has(item.id) ? (
                    <View accessibilityLabel={`Linked ${item.title || "Untitled"}`} style={styles.chipLink}>
                      <Check size={13} color={colors.mutedForeground} />
                    </View>
                  ) : (
                    <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Add link to ${item.title || "Untitled"}`} hitSlop={6}
                      onPress={() => { onLink(item); setLinked((prev) => new Set(prev).add(item.id)); }} style={styles.chipLink}>
                      <Link2 size={13} color={colors.primary} />
                    </AnimatedPressable>
                  )
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.list, style]}>
      {heading ?? <SectionLabel>Related</SectionLabel>}
      {items.map((item) => {
        const Icon = searchKindIcon(item.kind);
        return (
          <AnimatedPressable key={`${item.kind}:${item.id}`} accessibilityRole="button" accessibilityLabel={`Open ${item.kind}: ${item.title || "Untitled"}`}
            onPress={() => router.push(hrefFor(item.kind, item.id))} style={styles.row}>
            <View style={styles.icon}><Icon size={18} color={colors.primary} /></View>
            <View style={styles.content}>
              <Text numberOfLines={1} style={styles.title}>{item.title || "Untitled"}</Text>
              {item.snippet ? <Text numberOfLines={1} style={styles.snippet}>{item.snippet}</Text> : null}
            </View>
            <ArrowUpRight size={16} color={colors.mutedForeground} />
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  list: { gap: 8 },
  row: { borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 12, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, minWidth: 0 },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  snippet: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 2 },
  chipsWrap: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20, marginBottom: 8 },
  chipsHeading: { color: colors.mutedForeground, fontSize: 12 },
  chipsScroll: { flex: 1 },
  chips: { gap: 6, paddingRight: 20 },
  chip: { maxWidth: 200, minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 16, backgroundColor: colors.card },
  chipText: { flexShrink: 1, color: colors.foreground, fontSize: 12, fontWeight: "600" },
  chipGroup: { flexDirection: "row", alignItems: "center", gap: 2 },
  chipLink: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
}));
