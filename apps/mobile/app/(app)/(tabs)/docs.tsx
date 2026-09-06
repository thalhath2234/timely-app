import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { FileText, Sheet as SheetIcon, Star } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import EmptyState from "../../../components/ui/EmptyState";
import { useDocsQuery, useSheetsQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { sheetHref } from "../../../lib/sheet";
import { timeAgo } from "../../../lib/format";
import { colors } from "../../../lib/theme";

type Kind = "docs" | "sheets";

export default function FilesScreen() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("docs");
  const docsQ = useDocsQuery();
  const sheetsQ = useSheetsQuery();
  const spaces = useWorkspacesQuery().data ?? [];
  const docs = useMemo(
    () => (docsQ.data ?? []).filter((d) => !d.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [docsQ.data],
  );
  const sheets = useMemo(
    () =>
      (sheetsQ.data ?? [])
        .filter((s) => !s.archivedAt)
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [sheetsQ.data],
  );
  const wsById = useMemo(() => new Map(spaces.map((w) => [w.id, w])), [spaces]);
  const favoriteDocs = docs.filter((d) => d.isFavorite);
  const favoriteSheets = sheets.filter((s) => s.isFavorite);
  const restSheets = sheets.filter((s) => !s.isFavorite);

  return (
    <Screen>
      <MobileHeader
        title="Files"
        subtitle={kind === "docs" ? `${docs.length} pages` : `${sheets.length} tables`}
      >
        <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
          <SegmentedControl
            options={[
              { label: "Docs", value: "docs" },
              { label: "Sheets", value: "sheets" },
            ]}
            value={kind}
            onChange={setKind}
          />
        </View>
      </MobileHeader>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 110, gap: 10 }}>
        {kind === "docs" ? (
          docs.length === 0 ? (
            <EmptyState icon={FileText} title="No docs yet" description="Tap + to start a page." />
          ) : (
            <>
              {favoriteDocs.length ? <Text style={styles.section}>Favorites</Text> : null}
              {favoriteDocs.map((doc) => (
                <Pressable key={doc.id} onPress={() => router.push(`/(app)/docs/${doc.id}`)} style={styles.card}>
                  <Text style={styles.icon}>{doc.icon || "📄"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{doc.title || "Untitled"}</Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {doc.plainText || timeAgo(doc.updatedAt)}
                    </Text>
                  </View>
                  <Star size={16} color={colors.warning} fill={colors.warning} />
                </Pressable>
              ))}
              <Text style={styles.section}>Recent</Text>
              {docs.map((doc) => (
                <Pressable key={`r-${doc.id}`} onPress={() => router.push(`/(app)/docs/${doc.id}`)} style={styles.card}>
                  <Text style={styles.icon}>{doc.icon || "📄"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{doc.title || "Untitled"}</Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {timeAgo(doc.updatedAt)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </>
          )
        ) : sheets.length === 0 ? (
          <EmptyState icon={SheetIcon} title="No sheets yet" description="Tap + to create a table." />
        ) : (
          <>
            {favoriteSheets.length ? <Text style={styles.section}>Favorites</Text> : null}
            {favoriteSheets.map((sheet) => (
              <Pressable key={sheet.id} onPress={() => router.push(sheetHref(sheet.id))} style={styles.card}>
                <Text style={styles.icon}>{sheet.icon || "▦"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{sheet.title || "Untitled"}</Text>
                  <Text numberOfLines={1} style={styles.meta}>
                    {(sheet.rows ?? []).length} rows · {(sheet.columns ?? []).length} cols
                    {sheet.updatedAt ? ` · ${timeAgo(sheet.updatedAt)}` : ""}
                    {wsById.get(sheet.workspaceId) ? ` · ${wsById.get(sheet.workspaceId)?.name}` : ""}
                  </Text>
                </View>
                <Star size={16} color={colors.warning} fill={colors.warning} />
              </Pressable>
            ))}
            {restSheets.length ? <Text style={styles.section}>All sheets</Text> : null}
            {restSheets.map((sheet) => (
              <Pressable key={`a-${sheet.id}`} onPress={() => router.push(sheetHref(sheet.id))} style={styles.card}>
                <Text style={styles.icon}>{sheet.icon || "▦"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{sheet.title || "Untitled"}</Text>
                  <Text numberOfLines={1} style={styles.meta}>
                    {(sheet.rows ?? []).length} rows · {(sheet.columns ?? []).length} cols
                    {sheet.updatedAt ? ` · ${timeAgo(sheet.updatedAt)}` : ""}
                    {wsById.get(sheet.workspaceId) ? ` · ${wsById.get(sheet.workspaceId)?.name}` : ""}
                  </Text>
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
  icon: { fontSize: 20, width: 28, textAlign: "center", color: colors.foreground },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
});
