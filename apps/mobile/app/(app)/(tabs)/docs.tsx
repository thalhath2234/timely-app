import { useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, FileText, MoreVertical, Sheet as SheetIcon, Star, Upload } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import EmptyState from "../../../components/ui/EmptyState";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import { useCreateDoc, useCreateSheet, useDocsQuery, useSheetsQuery, useUpdateDoc, useWorkspacesQuery } from "../../../lib/hooks";
import { fromMarkdown } from "../../../lib/markdown";
import { csvToGrid } from "../../../lib/sheetCsv";
import { sheetHref } from "../../../lib/sheet";
import { buildDocTree, countDocDescendants, type DocNode } from "../../../lib/docTree";
import { timeAgo } from "../../../lib/format";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import type { Doc } from "../../../lib/types";

type Kind = "docs" | "sheets";

export default function FilesScreen() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("docs");
  const [showArchived, setShowArchived] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [menuDoc, setMenuDoc] = useState<DocNode | null>(null);
  const docsQ = useDocsQuery();
  const sheetsQ = useSheetsQuery();
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  const createSheet = useCreateSheet();
  const spaces = useWorkspacesQuery().data ?? [];
  const docs = useMemo(
    () => (docsQ.data ?? []).filter((d) => (showArchived ? Boolean(d.archivedAt) : !d.archivedAt)),
    [docsQ.data, showArchived],
  );
  const tree = useMemo(() => buildDocTree(docs), [docs]);
  const sheets = useMemo(
    () =>
      (sheetsQ.data ?? [])
        .filter((s) => (showArchived ? Boolean(s.archivedAt) : !s.archivedAt))
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [sheetsQ.data, showArchived],
  );
  const networkCopy = needsNetworkCopy(kind === "docs" ? docsQ : sheetsQ);
  const wsById = useMemo(() => new Map(spaces.map((w) => [w.id, w])), [spaces]);
  const favoriteDocs = docs.filter((d) => d.isFavorite);
  const favoriteSheets = sheets.filter((s) => s.isFavorite);
  const restSheets = sheets.filter((s) => !s.isFavorite);

  function toggleExpanded(id: string) {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addSubpage(parent: Doc) {
    const page = await createDoc.mutateAsync({
      title: "Untitled",
      parentId: parent.id,
      workspaceId: parent.workspaceId,
    });
    setExpandedIds((previous) => new Set(previous).add(parent.id));
    setMenuDoc(null);
    router.push(`/(app)/docs/${page.id}`);
  }

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

  async function importCsv() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain", "text/*"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const source = await (await fetch(asset.uri)).text();
      const grid = csvToGrid(source);
      const title = (asset.name || "Imported sheet").replace(/\.csv$/i, "").trim() || "Imported sheet";
      const sheet = await createSheet.mutateAsync({ title, ...grid, workspaceId: spaces[0]?.id });
      router.push(sheetHref(sheet.id) as never);
    } catch (error) {
      Alert.alert("Could not import CSV", error instanceof Error ? error.message : "Pick a .csv file and try again.");
    }
  }

  function renderNode(node: DocNode, depth: number): ReactNode {
    const expanded = expandedIds.has(node.id);
    const hasChildren = node.children.length > 0;
    const descendantCount = countDocDescendants(node);
    return (
      <View key={node.id} style={{ gap: 8 }}>
        <View style={[styles.card, { marginLeft: depth * 16 }]}>
          <Pressable
            accessibilityLabel={expanded ? "Collapse" : "Expand"}
            onPress={() => toggleExpanded(node.id)}
            hitSlop={8}
            style={[styles.chevron, !hasChildren && { opacity: 0 }]}
            disabled={!hasChildren}
          >
            <ChevronRight
              size={16}
              color={colors.mutedForeground}
              style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
            />
          </Pressable>
          <Pressable
            onPress={() => router.push(`/(app)/docs/${node.id}`)}
            style={styles.cardBody}
          >
            <Text style={styles.icon}>{node.icon || "📄"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{node.title || "Untitled"}</Text>
              <Text numberOfLines={1} style={styles.meta}>
                {hasChildren ? `${descendantCount} nested · ` : ""}
                {timeAgo(node.updatedAt)}
              </Text>
            </View>
          </Pressable>
          {node.isFavorite ? <Star size={16} color={colors.warning} fill={colors.warning} /> : null}
          <Pressable
            accessibilityLabel="Page menu"
            onPress={() => setMenuDoc(node)}
            hitSlop={8}
            style={styles.menuBtn}
          >
            <MoreVertical size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
        {expanded ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </View>
    );
  }

  return (
    <Screen>
      <MobileHeader
        title="Files"
        subtitle={kind === "docs" ? `${docs.length} pages` : `${sheets.length} tables`}
        actions={
          <HeaderIconButton
            label={kind === "docs" ? "Import Markdown" : "Import CSV"}
            onPress={() => void (kind === "docs" ? importMarkdown() : importCsv())}
          >
            <Upload size={20} color={colors.foreground} />
          </HeaderIconButton>
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
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: 110, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={(kind === "docs" ? docsQ.isRefetching : sheetsQ.isRefetching) && !(kind === "docs" ? docsQ.isPending : sheetsQ.isPending)}
            onRefresh={() => void (kind === "docs" ? docsQ.refetch() : sheetsQ.refetch())}
            tintColor={colors.primary}
          />
        }
      >
        {networkCopy ? (
          <EmptyState
            icon={kind === "docs" ? FileText : SheetIcon}
            title={kind === "docs" ? "Couldn't load docs" : "Couldn't load sheets"}
            description={networkCopy}
          />
        ) : kind === "docs" ? (
          docs.length === 0 ? (
            <EmptyState icon={FileText} title="No docs yet" description="Tap + to start a page." />
          ) : (
            <>
              {favoriteDocs.length ? <Text style={styles.section}>Favorites</Text> : null}
              {favoriteDocs.map((doc) => (
                <Pressable key={`fav-${doc.id}`} onPress={() => router.push(`/(app)/docs/${doc.id}`)} style={styles.card}>
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
              <Text style={styles.section}>Pages</Text>
              {tree.map((node) => renderNode(node, 0))}
            </>
          )
        ) : sheets.length === 0 ? (
          <EmptyState icon={SheetIcon} title="No sheets yet" description="Tap + to create a table, or import a CSV." />
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
      <BottomSheet open={Boolean(menuDoc)} onClose={() => setMenuDoc(null)} title={menuDoc?.title || "Page"}>
        <SheetOption
          onSelect={() => {
            if (!menuDoc) return;
            const id = menuDoc.id;
            setMenuDoc(null);
            router.push(`/(app)/docs/${id}`);
          }}
        >
          Open
        </SheetOption>
        <SheetOption onSelect={() => menuDoc && void addSubpage(menuDoc)}>Add subpage</SheetOption>
        {menuDoc?.parentId ? (
          <SheetOption
            onSelect={() => {
              if (!menuDoc) return;
              updateDoc.mutate({ id: menuDoc.id, data: { parentId: null } });
              setMenuDoc(null);
            }}
          >
            Move to top level
          </SheetOption>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  section: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginTop: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 8,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  chevron: { width: 32, height: 44, alignItems: "center", justifyContent: "center" },
  menuBtn: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  icon: { fontSize: 20, width: 28, textAlign: "center", color: colors.foreground },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
}));
