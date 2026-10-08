import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { availableTemplates, contentFromTemplate, dailyNoteTemplate, dateKey, templateVars, type DocTemplate } from "@timely/contract/templates";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Archive, ArchiveRestore, CalendarDays, ChevronRight, FilePlus, FileText, FolderUp, LayoutTemplate, MoreVertical, Sheet as SheetIcon, Star, Trash2, Upload } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import EmptyState from "../../../components/ui/EmptyState";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet from "../../../components/ui/ConfirmSheet";
import { keys, useCreateDoc, useCreateSheet, useDeleteDoc, useDocsQuery, useSheetsQuery, useSheetTemplatesQuery, useUpdateDoc, useWorkspacesQuery } from "../../../lib/hooks";
import { fromMarkdown } from "../../../lib/markdown";
import { csvToGrid } from "../../../lib/sheetCsv";
import { sheetHref } from "../../../lib/sheet";
import { buildDocTree, countDocDescendants, type DocNode } from "../../../lib/docTree";
import { timeAgo } from "../../../lib/format";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { easeOut, expandEntering, expandExiting, listLayout, overlayDuration } from "../../../lib/motion";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import { openDailyDoc } from "../../../lib/api/docs";
import type { Doc } from "../../../lib/types";

type Kind = "docs" | "sheets";

function DocsExpandButton({
  expanded,
  hasChildren,
  onPress,
}: {
  expanded: boolean;
  hasChildren: boolean;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(expanded ? 90 : 0);

  useEffect(() => {
    const next = expanded ? 90 : 0;
    rotation.value = reduceMotion ? next : withTiming(next, { duration: overlayDuration, easing: easeOut });
  }, [expanded, reduceMotion, rotation]);

  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Pressable
      accessibilityLabel={expanded ? "Collapse" : "Expand"}
      onPress={onPress}
      hitSlop={8}
      disabled={!hasChildren}
      style={[styles.chevron, !hasChildren && { opacity: 0 }]}
    >
      <Animated.View pointerEvents="none" collapsable={false} style={[styles.chevronGlyph, arrowStyle]}>
        <ChevronRight size={16} color={colors.mutedForeground} />
      </Animated.View>
    </Pressable>
  );
}

export default function FilesScreen() {
  const router = useRouter();
  const reduceMotion = Boolean(useReducedMotion());
  const [kind, setKind] = useState<Kind>("docs");
  const [showArchived, setShowArchived] = useState(false);
  useAssistantScreen([contextChip("file-view", "Files", { kind, showArchived })]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [menuDoc, setMenuDoc] = useState<Doc | null>(null);
  const [deleteDocItem, setDeleteDocItem] = useState<Doc | null>(null);
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<Doc | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const queryClient = useQueryClient();
  const docsQ = useDocsQuery();
  const sheetsQ = useSheetsQuery();
  const templatesQ = useSheetTemplatesQuery();
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  const removeDoc = useDeleteDoc();
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
  const templates = showArchived ? [] : templatesQ.data ?? [];

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

  async function createFromTemplate(template: DocTemplate) {
    setTemplatesOpen(false);
    try {
      const title = template.id.startsWith("builtin:") ? template.title : `${template.title} copy`;
      const { content, plainText } = contentFromTemplate(template, templateVars(new Date(), title));
      const doc = await createDoc.mutateAsync({ title, icon: template.icon, content, plainText, workspaceId: spaces[0]?.id });
      router.push(`/(app)/docs/${doc.id}`);
    } catch (error) {
      Alert.alert("Could not create the doc", error instanceof Error ? error.message : "Try again.");
    }
  }

  async function openToday() {
    try {
      const now = new Date();
      const date = dateKey(now);
      const { content, plainText } = contentFromTemplate(dailyNoteTemplate(docsQ.data ?? []), templateVars(now, date));
      const { document } = await openDailyDoc({ date, title: date, content, plainText, workspaceId: spaces[0]?.id });
      await queryClient.invalidateQueries({ queryKey: keys.docs });
      router.push(`/(app)/docs/${document.id}`);
    } catch (error) {
      Alert.alert("Could not open today's note", error instanceof Error ? error.message : "Try again.");
    }
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
      <Animated.View key={node.id} layout={listLayout(reduceMotion)} style={{ gap: 8 }}>
        <View style={[styles.card, { marginLeft: Math.min(depth, 3) * 12 }]}>
          <DocsExpandButton
            expanded={expanded}
            hasChildren={hasChildren}
            onPress={() => toggleExpanded(node.id)}
          />
          <AnimatedPressable
            onPress={() => router.push(`/(app)/docs/${node.id}`)}
            onLongPress={() => setMenuDoc(node)}
            style={styles.cardBody}
          >
            <Text style={styles.icon}>{node.icon || "📄"}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title}>{node.title || "Untitled"}</Text>
              <Text numberOfLines={2} style={styles.meta}>
                {hasChildren ? `${descendantCount} nested · ` : ""}
                {timeAgo(node.updatedAt)}
              </Text>
            </View>
          </AnimatedPressable>
          {node.isFavorite ? <Star size={16} color={colors.warning} fill={colors.warning} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Page menu"
            onPress={() => setMenuDoc(node)}
            hitSlop={8}
            style={styles.menuBtn}
          >
            <MoreVertical size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
        {expanded ? (
          <Animated.View
            entering={expandEntering(reduceMotion)}
            exiting={expandExiting(reduceMotion)}
            style={{ gap: 8 }}
          >
            {node.children.map((child) => renderNode(child, depth + 1))}
          </Animated.View>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Screen>
      <MobileHeader
        title="Files"
        subtitle={kind === "docs" ? `${docs.length} ${docs.length === 1 ? "page" : "pages"}` : `${sheets.length} ${sheets.length === 1 ? "table" : "tables"} · ${templates.length} ${templates.length === 1 ? "template" : "templates"}`}
        actions={
          <>
            <HeaderIconButton
              label={showArchived ? "Show active files" : "Show archived files"}
              active={showArchived}
              onPress={() => setShowArchived((previous) => !previous)}
            >
              {showArchived ? <ArchiveRestore size={20} color={colors.primary} /> : <Archive size={20} color={colors.foreground} />}
            </HeaderIconButton>
            {kind === "docs" ? (
              <>
                <HeaderIconButton label="Open today's daily note" onPress={() => void openToday()}>
                  <CalendarDays size={20} color={colors.foreground} />
                </HeaderIconButton>
                <HeaderIconButton label="New doc from a template" onPress={() => setTemplatesOpen(true)}>
                  <LayoutTemplate size={20} color={colors.foreground} />
                </HeaderIconButton>
              </>
            ) : null}
            <HeaderIconButton
              label={kind === "docs" ? "Import Markdown" : "Import CSV"}
              onPress={() => void (kind === "docs" ? importMarkdown() : importCsv())}
            >
              <Upload size={20} color={colors.foreground} />
            </HeaderIconButton>
          </>
        }
      >
        <View style={styles.headerControls}>
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
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={(kind === "docs" ? docsQ.isRefetching : sheetsQ.isRefetching || templatesQ.isRefetching) && !(kind === "docs" ? docsQ.isPending : sheetsQ.isPending)}
            onRefresh={() => {
              if (kind === "docs") void docsQ.refetch();
              else { void sheetsQ.refetch(); void templatesQ.refetch(); }
            }}
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
                <View key={`fav-${doc.id}`} style={styles.card}>
                  <AnimatedPressable onPress={() => router.push(`/(app)/docs/${doc.id}`)} onLongPress={() => setMenuDoc(doc)} style={styles.cardBody}>
                    <Text style={styles.icon}>{doc.icon || "📄"}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.title}>{doc.title || "Untitled"}</Text>
                      <Text numberOfLines={2} style={styles.meta}>
                        {doc.plainText || timeAgo(doc.updatedAt)}
                      </Text>
                    </View>
                  </AnimatedPressable>
                  <Star size={16} color={colors.warning} fill={colors.warning} />
                  <Pressable accessibilityRole="button" accessibilityLabel="Page menu" onPress={() => setMenuDoc(doc)} hitSlop={8} style={styles.menuBtn}>
                    <MoreVertical size={18} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ))}
              <Text style={styles.section}>Pages</Text>
              {tree.map((node) => renderNode(node, 0))}
            </>
          )
        ) : sheets.length === 0 && templates.length === 0 && !templatesQ.isError ? (
          <EmptyState icon={SheetIcon} title="No sheets yet" description="Tap + to create a table, or import a CSV." />
        ) : (
          <>
            {templatesQ.isError ? <Pressable onPress={() => void templatesQ.refetch()}><Text style={styles.templateError}>Could not load templates. Tap to retry.</Text></Pressable> : null}
            {favoriteSheets.length ? <Text style={styles.section}>Favorites</Text> : null}
            {favoriteSheets.map((sheet) => (
              <AnimatedPressable key={sheet.id} onPress={() => router.push(sheetHref(sheet.id))} style={styles.card}>
                <Text style={styles.icon}>{sheet.icon || "▦"}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.title}>{sheet.title || "Untitled"}</Text>
                  <Text numberOfLines={2} style={styles.meta}>
                    {(sheet.rows ?? []).length} rows · {(sheet.columns ?? []).length} cols
                    {sheet.updatedAt ? ` · ${timeAgo(sheet.updatedAt)}` : ""}
                    {wsById.get(sheet.workspaceId) ? ` · ${wsById.get(sheet.workspaceId)?.name}` : ""}
                  </Text>
                </View>
                <Star size={16} color={colors.warning} fill={colors.warning} />
              </AnimatedPressable>
            ))}
            {restSheets.length ? <Text style={styles.section}>All sheets</Text> : null}
            {restSheets.map((sheet) => (
              <AnimatedPressable key={`a-${sheet.id}`} onPress={() => router.push(sheetHref(sheet.id))} style={styles.card}>
                <Text style={styles.icon}>{sheet.icon || "▦"}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.title}>{sheet.title || "Untitled"}</Text>
                  <Text numberOfLines={2} style={styles.meta}>
                    {(sheet.rows ?? []).length} rows · {(sheet.columns ?? []).length} cols
                    {sheet.updatedAt ? ` · ${timeAgo(sheet.updatedAt)}` : ""}
                    {wsById.get(sheet.workspaceId) ? ` · ${wsById.get(sheet.workspaceId)?.name}` : ""}
                  </Text>
                </View>
              </AnimatedPressable>
            ))}
            {templates.length ? <Text style={styles.section}>Templates</Text> : null}
            {templates.map((template) => (
              <AnimatedPressable
                key={template.id}
                onPress={() => router.push({ pathname: "/(app)/sheets/templates/[id]", params: { id: template.id } })}
                style={styles.card}
              >
                {template.icon ? <Text style={styles.icon}>{template.icon}</Text> : <LayoutTemplate size={20} color={colors.foreground} style={{ width: 28 }} />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.title}>{template.name}</Text>
                  <Text numberOfLines={2} style={styles.meta}>
                    {template.rows.length} rows · {template.columns.length} cols
                    {(template.tabs?.length ?? 0) > 1 ? ` · ${template.tabs?.length} tabs` : ""}
                  </Text>
                </View>
              </AnimatedPressable>
            ))}
          </>
        )}
      </ScrollView>
      <BottomSheet
        open={Boolean(menuDoc)}
        onClose={() => setMenuDoc(null)}
        onClosed={() => {
          if (pendingDeleteDoc) {
            setDeleteDocItem(pendingDeleteDoc);
            setPendingDeleteDoc(null);
          }
        }}
        title={menuDoc?.title || "Page"}
      >
        <SheetOption
          onSelect={() => {
            if (!menuDoc) return;
            const id = menuDoc.id;
            setMenuDoc(null);
            router.push(`/(app)/docs/${id}`);
          }}
          leading={<FileText size={18} color={colors.mutedForeground} />}
        >
          Open
        </SheetOption>
        <SheetOption onSelect={() => menuDoc && void addSubpage(menuDoc)} leading={<FilePlus size={18} color={colors.mutedForeground} />}>Add subpage</SheetOption>
        <SheetOption
          onSelect={() => {
            if (!menuDoc) return;
            updateDoc.mutate({ id: menuDoc.id, data: { isFavorite: !menuDoc.isFavorite } });
            setMenuDoc(null);
          }}
          leading={<Star size={18} color={colors.mutedForeground} />}
        >
          {menuDoc?.isFavorite ? "Remove favorite" : "Add favorite"}
        </SheetOption>
        {menuDoc?.parentId ? (
          <SheetOption
            onSelect={() => {
              if (!menuDoc) return;
              updateDoc.mutate({ id: menuDoc.id, data: { parentId: null } });
              setMenuDoc(null);
            }}
            leading={<FolderUp size={18} color={colors.mutedForeground} />}
          >
            Move to top level
          </SheetOption>
        ) : null}
        <SheetOption
          onSelect={() => {
            if (!menuDoc) return;
            updateDoc.mutate({ id: menuDoc.id, data: { isTemplate: !menuDoc.isTemplate } });
            setMenuDoc(null);
          }}
          leading={<LayoutTemplate size={18} color={colors.mutedForeground} />}
        >
          {menuDoc?.isTemplate ? "Stop using as a template" : "Use as a template"}
        </SheetOption>
        <SheetOption
          onSelect={() => {
            if (!menuDoc) return;
            updateDoc.mutate({ id: menuDoc.id, data: { archived: !Boolean(menuDoc.archivedAt) } });
            setMenuDoc(null);
          }}
          leading={<Archive size={18} color={colors.mutedForeground} />}
        >
          {menuDoc?.archivedAt ? "Unarchive" : "Archive"}
        </SheetOption>
        <SheetOption
          onSelect={() => {
            setPendingDeleteDoc(menuDoc);
            setMenuDoc(null);
          }}
          leading={<Trash2 size={18} color={colors.destructive} />}
        >
          <Text style={styles.destructive}>Delete page</Text>
        </SheetOption>
      </BottomSheet>
      <BottomSheet open={templatesOpen} onClose={() => setTemplatesOpen(false)} title="New from template">
        {availableTemplates(docsQ.data ?? []).map((template) => (
          <SheetOption
            key={template.id}
            onSelect={() => void createFromTemplate(template)}
            leading={<Text style={styles.templateIcon}>{template.icon}</Text>}
          >
            {template.title}
          </SheetOption>
        ))}
        <Text style={styles.templateHint}>Turn any page into a template from its menu. Text like {"{{date}}"} is filled in.</Text>
      </BottomSheet>
      <ConfirmSheet
        open={deleteDocItem !== null}
        onClose={() => setDeleteDocItem(null)}
        title="Delete this page?"
        message={deleteDocItem ? `“${deleteDocItem.title || "Untitled"}” will be permanently removed, along with any subpages.` : undefined}
        onConfirm={() => {
          if (!deleteDocItem) return;
          removeDoc.mutate(deleteDocItem.id, {
            onError: (cause) => Alert.alert("Could not delete page", cause instanceof Error ? cause.message : "Try again."),
          });
        }}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  headerControls: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120, gap: 10 },
  templateError: { color: colors.destructive, fontSize: 13 },
  templateIcon: { fontSize: 18, width: 22, textAlign: "center" },
  templateHint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, paddingHorizontal: 16, paddingTop: 8 },
  destructive: { color: colors.destructive, fontSize: 15, fontWeight: "600" },
  section: { color: colors.foreground, fontSize: 19, fontWeight: "800", marginTop: 12, marginBottom: 2, letterSpacing: -0.3 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 76,
    overflow: "visible",
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  chevron: { width: 32, height: 44, alignItems: "center", justifyContent: "center", overflow: "visible" },
  chevronGlyph: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  menuBtn: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  icon: { fontSize: 22, width: 44, height: 44, lineHeight: 44, borderRadius: 16, overflow: "hidden", textAlign: "center", textAlignVertical: "center", backgroundColor: colors.accent, color: colors.foreground },
  title: { color: colors.foreground, fontSize: 15, lineHeight: 20, fontWeight: "700", flexShrink: 1 },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 4 },
}));
