import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Search as SearchIcon } from "lucide-react-native";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import { Field } from "../../components/ui/primitives";
import EmptyState from "../../components/ui/EmptyState";
import { useSearchQuery } from "../../lib/hooks";
import type { SearchKind } from "../../lib/api/search";
import { sheetHref } from "../../lib/sheet";
import { colors } from "../../lib/theme";

function hrefFor(kind: SearchKind, id: string) {
  if (kind === "task") return `/(app)/tasks/${id}`;
  if (kind === "doc") return `/(app)/docs/${id}`;
  if (kind === "sheet") return sheetHref(id);
  if (kind === "event") return `/(app)/events/${id}`;
  if (kind === "project") return `/(app)/(tabs)/tasks?projectId=${id}`;
  return "/(app)/(tabs)/tasks";
}

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const results = useSearchQuery(query);
  const hits = results.data ?? [];
  const trimmed = query.trim();

  return (
    <Screen>
      <MobileHeader title="Search" back large={false} />
      <View style={{ padding: 12 }}>
        <Field value={query} onChangeText={setQuery} placeholder="Search by meaning or keywords" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
        {!trimmed ? (
          <EmptyState
            icon={SearchIcon}
            title="Search Timely"
            description="Search by meaning or keywords across tasks, docs, sheets, events, and projects."
          />
        ) : results.isFetching && hits.length === 0 ? (
          <Text style={styles.status}>Searching…</Text>
        ) : results.isError ? (
          <EmptyState icon={SearchIcon} title="Search failed" description="Check your connection and try again." />
        ) : hits.length === 0 ? (
          <EmptyState icon={SearchIcon} title="No matches" description="Try a different phrase." />
        ) : (
          hits.map((hit) => (
            <Pressable
              key={`${hit.kind}-${hit.id}`}
              onPress={() => router.push(hrefFor(hit.kind, hit.id) as never)}
              style={styles.card}
            >
              <Text style={styles.kind}>{hit.kind}</Text>
              <Text style={styles.title}>{hit.title}</Text>
              {hit.snippet ? (
                <Text numberOfLines={2} style={styles.snip}>
                  {hit.snippet}
                </Text>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  kind: { color: colors.primary, fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500", marginTop: 4 },
  snip: { color: colors.mutedForeground, fontSize: 12, marginTop: 4 },
  status: { color: colors.mutedForeground, fontSize: 14, padding: 16, textAlign: "center" },
});
