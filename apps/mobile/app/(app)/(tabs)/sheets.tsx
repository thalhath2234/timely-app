import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Search, Sheet as SheetIcon, Star, X } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import { Field } from "../../../components/ui/primitives";
import EmptyState from "../../../components/ui/EmptyState";
import { useSheetsQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { sheetHref } from "../../../lib/sheet";
import { timeAgo } from "../../../lib/format";
import { colors } from "../../../lib/theme";

export default function SheetsScreen() {
  const router = useRouter();
  const sheetsQ = useSheetsQuery();
  const spaces = useWorkspacesQuery().data ?? [];
  const sheets = sheetsQ.data ?? [];
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const wsById = useMemo(() => new Map(spaces.map((w) => [w.id, w])), [spaces]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sheets
      .filter((s) => !s.archivedAt && (!q || (s.title || "").toLowerCase().includes(q)))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [sheets, query]);
  const favorites = filtered.filter((s) => s.isFavorite);
  const rest = filtered.filter((s) => !s.isFavorite);

  function openSheet(id: string) {
    router.push(sheetHref(id));
  }

  return (
    <Screen>
      <MobileHeader
        title="Sheets"
        subtitle={`${filtered.length} tables`}
        actions={
          <HeaderIconButton label="Search" active={searchOpen} onPress={() => { setSearchOpen((v) => !v); setQuery(""); }}>
            {searchOpen ? <X size={20} color={colors.foreground} /> : <Search size={20} color={colors.foreground} />}
          </HeaderIconButton>
        }
      >
        {searchOpen ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
            <Field value={query} onChangeText={setQuery} placeholder="Search sheets" />
          </View>
        ) : null}
      </MobileHeader>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 110, gap: 10 }}>
        {filtered.length === 0 ? (
          <EmptyState icon={SheetIcon} title="No sheets yet" description="Tap + to create a table." />
        ) : (
          <>
            {favorites.length ? <Text style={styles.section}>Favorites</Text> : null}
            {favorites.map((sheet) => (
              <SheetCard
                key={sheet.id}
                title={sheet.title}
                icon={sheet.icon}
                favorite
                meta={`${(sheet.rows ?? []).length} rows · ${(sheet.columns ?? []).length} cols${
                  sheet.updatedAt ? ` · ${timeAgo(sheet.updatedAt)}` : ""
                }${wsById.get(sheet.workspaceId) ? ` · ${wsById.get(sheet.workspaceId)?.name}` : ""}`}
                onPress={() => openSheet(sheet.id)}
              />
            ))}
            {rest.length ? <Text style={styles.section}>All sheets</Text> : null}
            {rest.map((sheet) => (
              <SheetCard
                key={`a-${sheet.id}`}
                title={sheet.title}
                icon={sheet.icon}
                meta={`${(sheet.rows ?? []).length} rows · ${(sheet.columns ?? []).length} cols${
                  sheet.updatedAt ? ` · ${timeAgo(sheet.updatedAt)}` : ""
                }${wsById.get(sheet.workspaceId) ? ` · ${wsById.get(sheet.workspaceId)?.name}` : ""}`}
                onPress={() => openSheet(sheet.id)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SheetCard({
  title,
  icon,
  meta,
  favorite,
  onPress,
}: {
  title: string;
  icon: string | null;
  meta: string;
  favorite?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <Text style={styles.icon}>{icon || "▦"}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title || "Untitled"}</Text>
        <Text style={styles.meta}>{meta}</Text>
      </View>
      {favorite ? <Star size={16} color={colors.warning} fill={colors.warning} /> : null}
    </Pressable>
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
  icon: { fontSize: 20, width: 28, textAlign: "center", color: colors.foreground },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
});
