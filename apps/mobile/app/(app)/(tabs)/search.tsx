import { useState } from "react";
import { Keyboard, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarDays, FileText, FolderKanban, ListTodo, Search as SearchIcon, Table2, X } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { useSearchQuery } from "../../../lib/hooks";
import type { SearchKind } from "../../../lib/api/search";
import { sheetHref } from "../../../lib/sheet";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

function hrefFor(kind: SearchKind, id: string) {
  if (kind === "task") return `/(app)/tasks/${id}`;
  if (kind === "doc") return `/(app)/docs/${id}`;
  if (kind === "sheet") return sheetHref(id);
  if (kind === "event") return `/(app)/events/${id}`;
  if (kind === "project") return `/(app)/projects/${id}`;
  return "/(app)/(tabs)/tasks";
}

function iconFor(kind: SearchKind) {
  if (kind === "task") return ListTodo;
  if (kind === "doc") return FileText;
  if (kind === "sheet") return Table2;
  if (kind === "event") return CalendarDays;
  return FolderKanban;
}

export default function SearchTab() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const results = useSearchQuery(query);
  const hits = results.data ?? [];
  const trimmed = query.trim();

  return (
    <Screen>
      <MobileHeader title="Search" />
      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <SearchIcon size={22} color={colors.primary} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search Timely"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            accessibilityLabel="Search Timely"
          />
          {query ? (
            <AnimatedPressable accessibilityLabel="Clear search" onPress={() => setQuery("")} style={styles.clearButton}>
              <X size={19} color={colors.mutedForeground} />
            </AnimatedPressable>
          ) : null}
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
        {!trimmed ? (
          <View style={styles.discovery}>
            <View style={styles.discoveryIcon}><SearchIcon size={28} color={colors.primary} /></View>
            <Text style={styles.discoveryTitle}>Find it all in one place.</Text>
            <Text style={styles.discoveryCopy}>Search tasks, files, events, and projects by name or meaning.</Text>
            <View style={styles.discoveryDivider} />
            <Text style={styles.discoveryHint}>Start typing to explore your workspace</Text>
          </View>
        ) : results.isFetching && hits.length === 0 ? (
          <Text style={styles.status}>Searching…</Text>
        ) : results.isError ? (
          <EmptyState icon={SearchIcon} title="Search failed" description="Check your connection and try again." />
        ) : hits.length === 0 ? (
          <EmptyState icon={SearchIcon} title="No matches" description="Try a different phrase." />
        ) : (
          <>
            <Text style={styles.resultHeading}>{hits.length} {hits.length === 1 ? "result" : "results"}</Text>
            {hits.map((hit) => {
              const Icon = iconFor(hit.kind);
              return (
                <AnimatedPressable
                  key={`${hit.kind}-${hit.id}`}
                  onPress={() => router.push(hrefFor(hit.kind, hit.id) as never)}
                  style={styles.card}
                >
                  <View style={styles.resultIcon}><Icon size={20} color={colors.primary} /></View>
                  <View style={styles.resultContent}>
                    <Text style={styles.kind}>{hit.kind}</Text>
                    <Text numberOfLines={2} style={styles.title}>{hit.title}</Text>
                    {hit.snippet ? <Text numberOfLines={2} style={styles.snip}>{hit.snippet}</Text> : null}
                  </View>
                </AnimatedPressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  searchWrap: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  searchBox: { minHeight: 56, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 10 },
  input: { flex: 1, color: colors.foreground, fontSize: 16, minHeight: 52, paddingVertical: 0 },
  clearButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  results: { paddingHorizontal: 16, paddingTop: 12, gap: 10, paddingBottom: 120 },
  discovery: { borderRadius: 24, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 20, gap: 10, marginTop: 6 },
  discoveryIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginBottom: 3 },
  discoveryTitle: { color: colors.foreground, fontSize: 21, lineHeight: 27, fontWeight: "800", letterSpacing: -0.3 },
  discoveryCopy: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  discoveryDivider: { height: 1, backgroundColor: colors.border, marginTop: 6 },
  discoveryHint: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  resultHeading: { color: colors.foreground, fontSize: 18, fontWeight: "800", marginBottom: 4 },
  card: {
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  resultIcon: { width: 42, height: 42, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  resultContent: { flex: 1, minWidth: 0 },
  kind: { color: colors.primary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  title: { color: colors.foreground, fontSize: 16, fontWeight: "700", marginTop: 4 },
  snip: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18, marginTop: 5 },
  status: { color: colors.mutedForeground, fontSize: 14, padding: 16, textAlign: "center" },
}));
