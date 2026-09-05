import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { FileText, Search, Star, X } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import { Field } from "../../../components/ui/primitives";
import EmptyState from "../../../components/ui/EmptyState";
import { useDocsQuery } from "../../../lib/hooks";
import { timeAgo } from "../../../lib/format";
import { colors } from "../../../lib/theme";

export default function DocsScreen() {
  const router = useRouter();
  const docsQ = useDocsQuery();
  const docs = docsQ.data ?? [];
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => !d.archivedAt && (!q || d.title.toLowerCase().includes(q) || d.plainText.toLowerCase().includes(q)));
  }, [docs, query]);
  const favorites = filtered.filter((d) => d.isFavorite);
  const recent = [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Screen>
      <MobileHeader
        title="Docs"
        subtitle={`${filtered.length} pages`}
        actions={
          <HeaderIconButton label="Search" active={searchOpen} onPress={() => { setSearchOpen((v) => !v); setQuery(""); }}>
            {searchOpen ? <X size={20} color={colors.foreground} /> : <Search size={20} color={colors.foreground} />}
          </HeaderIconButton>
        }
      >
        {searchOpen ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
            <Field value={query} onChangeText={setQuery} placeholder="Search docs" />
          </View>
        ) : null}
      </MobileHeader>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 110, gap: 10 }}>
        {filtered.length === 0 ? (
          <EmptyState icon={FileText} title="No docs yet" description="Tap + to start a page." />
        ) : (
          <>
            {favorites.length ? <Text style={styles.section}>Favorites</Text> : null}
            {favorites.map((doc) => (
              <Pressable key={doc.id} onPress={() => router.push(`/(app)/docs/${doc.id}`)} style={styles.card}>
                <Text style={styles.icon}>{doc.icon || "📄"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{doc.title || "Untitled"}</Text>
                  <Text numberOfLines={1} style={styles.meta}>{doc.plainText || timeAgo(doc.updatedAt)}</Text>
                </View>
                <Star size={16} color={colors.warning} fill={colors.warning} />
              </Pressable>
            ))}
            <Text style={styles.section}>Recent</Text>
            {recent.map((doc) => (
              <Pressable key={`r-${doc.id}`} onPress={() => router.push(`/(app)/docs/${doc.id}`)} style={styles.card}>
                <Text style={styles.icon}>{doc.icon || "📄"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{doc.title || "Untitled"}</Text>
                  <Text numberOfLines={1} style={styles.meta}>{timeAgo(doc.updatedAt)}</Text>
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginTop: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
  },
  icon: { fontSize: 22, width: 28, textAlign: "center" },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
});
