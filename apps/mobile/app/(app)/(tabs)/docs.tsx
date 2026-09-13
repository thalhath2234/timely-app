import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { FileText, Sheet as SheetIcon, Star, Upload } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import EmptyState from "../../../components/ui/EmptyState";
import { useCreateDoc, useDocsQuery, useSheetsQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { fromMarkdown } from "../../../lib/markdown";
import { sheetHref } from "../../../lib/sheet";
import { timeAgo } from "../../../lib/format";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

type Kind = "docs" | "sheets";

export default function FilesScreen() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("docs");
  const [showArchived, setShowArchived] = useState(false);
  const docsQ = useDocsQuery();
  const sheetsQ = useSheetsQuery();
  const createDoc = useCreateDoc();
  const spaces = useWorkspacesQuery().data ?? [];
  const docs = useMemo(
    () =>
      (docsQ.data ?? [])
        .filter((d) => (showArchived ? Boolean(d.archivedAt) : !d.archivedAt))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [docsQ.data, showArchived],
  );
  const sheets = useMemo(
    () =>
      (sheetsQ.data ?? [])
        .filter((s) => (showArchived ? Boolean(s.archivedAt) : !s.archivedAt))
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [sheetsQ.data, showArchived],
  );
  const wsById = useMemo(() => new Map(spaces.map((w) => [w.id, w])), [spaces]);
  const favoriteDocs = docs.filter((d) => d.isFavorite);
  const favoriteSheets = sheets.filter((s) => s.isFavorite);
  const restSheets = sheets.filter((s) => !s.isFavorite);

  async function importMarkdown() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/markdown", "text/plain", "text/*"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const response = await fetch(asset.uri);
      const source = await response.text();
      const parsed = fromMarkdown(source);
      const title = (asset.name || "Imported note").replace(/\.(md|markdown|txt)$/i, "").trim() || "Imported note";
      const doc = await createDoc.mutateAsync({
        title,
        content: parsed.content,
        plainText: parsed.plainText,
        workspaceId: spaces[0]?.id,
      });
      router.push(`/(app)/docs/${doc.id}`);
    } catch (error) {
      Alert.alert("Could not import", error instanceof Error ? error.message : "Pick a .md file and try again.");
    }
  }

  return (
    <Screen>
      <MobileHeader
        title="Files"
        subtitle={kind === "docs" ? `${docs.length} pages` : `${sheets.length} tables`}
        actions={
          kind === "docs" ? (
            <HeaderIconButton label="Import Markdown" onPress={() => void importMarkdown()}>
              <Upload size={20} color={colors.foreground} />
            </HeaderIconButton>
          ) : null
        }
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
          <Pressable onPress={() => setShowArchived((previous) => !previous)} style={{ paddingTop: 8 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {showArchived ? "Showing archived · tap for active" : "Show archived"}
            </Text>
          </Pressable>
        </View>
      </MobileHeader>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 110, gap: 10 }}>
        {(kind === "docs" ? docsQ.isError : sheetsQ.isError) ? (
          <EmptyState
            icon={kind === "docs" ? FileText : SheetIcon}
            title={kind === "docs" ? "Couldn't load docs" : "Couldn't load sheets"}
            description="Check your connection and try again."
          />
        ) : kind === "docs" ? (
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

const styles = createThemedStyleSheet((colors) => ({
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
}));
