import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { contentFromTemplate, dailyNoteTemplate, dateKey, templateVars } from "@timely/contract/templates";
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
import { keys, useCreateDoc, useCreateSheet, useDecisionsStatusQuery, useDeleteDoc, useDocsQuery, useSheetsQuery, useSheetTemplatesQuery, useUpdateDoc, useWorkspacesQuery } from "../../../lib/hooks";
import { parseImportedText } from "../../../lib/importMarkdown";
import { importCsvGrid } from "../../../lib/sheetCsv";
import { fileHref } from "../../../lib/fileRoutes";
import { buildDocTree, countDocDescendants, type DocNode } from "../../../lib/docTree";
import { timeAgo } from "../../../lib/format";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { easeOut, expandEntering, expandExiting, listLayout, overlayDuration } from "../../../lib/motion";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import { openDailyDoc } from "../../../lib/api/docs";
import { NewFileSheet, type FileKind } from "../../../components/files/NewFileTemplates";
import type { Doc, Sheet } from "../../../lib/types";

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

type Filter = "all" | "docs" | "sheets";
type PendingAction = FileKind | "markdown" | "csv" | null;

function FileGlyph({ icon, kind }: { icon?: string | null; kind: "doc" | "sheet" }) {
  // An item's own emoji wins; otherwise the type icon says what it is.
  if (icon) return <Text style={styles.icon}>{icon}</Text>;
  const Glyph = kind === "doc" ? FileText : SheetIcon;
  return (
    <View style={styles.iconBox}>
      <Glyph size={20} color={colors.foreground} />
    </View>
  );
}

function byFavoriteThenRecent(a: { isFavorite?: boolean; updatedAt?: string }, b: { isFavorite?: boolean; updatedAt?: string }) {
  return Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite)) || (b.updatedAt || "").localeCompare(a.updatedAt || "");
}

type Entry = { kind: "doc"; node: DocNode; updatedAt: string } | { kind: "sheet"; sheet: Sheet; updatedAt: string };

function entryItem(entry: Entry) {
  return entry.kind === "doc" ? entry.node : entry.sheet;
}

export default function FilesScreen() {
  const router = useRouter();
  const reduceMotion = Boolean(useReducedMotion());
  const [filter, setFilter] = useState<Filter>("all");
  // Other screens (search categories) can open the tab on one kind.
  const requestedFilter = useLocalSearchParams<{ filter?: string }>().filter;
  useEffect(() => {
    if (requestedFilter === "all" || requestedFilter === "docs" || requestedFilter === "sheets") setFilter(requestedFilter);
  }, [requestedFilter]);
  const [showArchived, setShowArchived] = useState(false);
  useAssistantScreen([contextChip("file-view", "Files", { kind: filter, showArchived })]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [menuDoc, setMenuDoc] = useState<Doc | null>(null);
  const [deleteDocItem, setDeleteDocItem] = useState<Doc | null>(null);
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<Doc | null>(null);
  const [newKind, setNewKind] = useState<FileKind | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const pendingAction = useRef<PendingAction>(null);
  const queryClient = useQueryClient();
  const docsQ = useDocsQuery();
  const sheetsQ = useSheetsQuery();
  const templatesQ = useSheetTemplatesQuery();
  const createDoc = useCreateDoc();
  const smartImport = useDecisionsStatusQuery().data?.available === true;
  const updateDoc = useUpdateDoc();
  const removeDoc = useDeleteDoc();
  const createSheet = useCreateSheet();
  const spaces = useWorkspacesQuery().data ?? [];
  const showDocs = filter !== "sheets";
  const showSheets = filter !== "docs";
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
  const networkCopy =
    filter === "docs"
      ? needsNetworkCopy(docsQ)
      : filter === "sheets"
        ? needsNetworkCopy(sheetsQ)
        : // All: only when neither list can load; one failing still shows the other.
          needsNetworkCopy(docsQ) && needsNetworkCopy(sheetsQ);
  const wsById = useMemo(() => new Map(spaces.map((w) => [w.id, w])), [spaces]);
  const favoriteDocs = docs.filter((d) => d.isFavorite);
  const favoriteSheets = sheets.filter((s) => s.isFavorite);
  const restSheets = sheets.filter((s) => !s.isFavorite);
  const templates = showArchived ? [] : templatesQ.data ?? [];
  // All: favourites pinned on top, then every file (docs keep their
  // subpages nested) by most recent update.
  const favoriteEntries = useMemo<Entry[]>(
    () =>
      [
        ...docs.filter((d) => d.isFavorite).map((d) => ({ kind: "doc" as const, node: { ...d, children: [] }, updatedAt: d.updatedAt })),
        ...sheets.filter((s) => s.isFavorite).map((s) => ({ kind: "sheet" as const, sheet: s, updatedAt: s.updatedAt })),
      ].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [docs, sheets],
  );
  const allEntries = useMemo<Entry[]>(
    () =>
      [
        ...tree.map((node) => ({ kind: "doc" as const, node, updatedAt: node.updatedAt })),
        ...sheets.map((sheet) => ({ kind: "sheet" as const, sheet, updatedAt: sheet.updatedAt })),
      ].sort((a, b) => byFavoriteThenRecent(entryItem(a), entryItem(b))),
    [tree, sheets],
  );

  function toggleExpanded(id: string) {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openFile(id: string) {
    router.push(fileHref(id));
  }

  async function addSubpage(parent: Doc) {
    const page = await createDoc.mutateAsync({
      title: "Untitled",
      parentId: parent.id,
      workspaceId: parent.workspaceId,
    });
    setExpandedIds((previous) => new Set(previous).add(parent.id));
    setMenuDoc(null);
    openFile(page.id);
  }

  async function openToday() {
    try {
      const now = new Date();
      const date = dateKey(now);
      const { content, plainText } = contentFromTemplate(dailyNoteTemplate(docsQ.data ?? []), templateVars(now, date));
      const { document } = await openDailyDoc({ date, title: date, content, plainText, workspaceId: spaces[0]?.id });
      await queryClient.invalidateQueries({ queryKey: keys.docs });
      openFile(document.id);
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
      const parsed = await parseImportedText(source, smartImport);
      const title = (asset.name || "Imported note").replace(/\.(md|markdown|txt)$/i, "").trim() || "Imported note";
      const doc = await createDoc.mutateAsync({
        title,
        content: parsed.content,
        plainText: parsed.plainText,
        workspaceId: spaces[0]?.id,
      });
      openFile(doc.id);
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
      const grid = await importCsvGrid(source);
      const title = (asset.name || "Imported sheet").replace(/\.csv$/i, "").trim() || "Imported sheet";
      const sheet = await createSheet.mutateAsync({ title, ...grid, workspaceId: spaces[0]?.id });
      openFile(sheet.id);
    } catch (error) {
      Alert.alert("Could not import CSV", error instanceof Error ? error.message : "Pick a .csv file and try again.");
    }
  }

  // Menus close before the next sheet or the system file picker opens.
  function runPendingAction() {
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action === "doc" || action === "sheet") setNewKind(action);
    else if (action === "markdown") void importMarkdown();
    else if (action === "csv") void importCsv();
  }

  function onNew() {
    if (filter === "docs") setNewKind("doc");
    else if (filter === "sheets") setNewKind("sheet");
    else setNewOpen(true);
  }

  function onImport() {
    if (filter === "docs") void importMarkdown();
    else if (filter === "sheets") void importCsv();
    else setImportOpen(true);
  }

  function renderDocRow(doc: Doc, meta: ReactNode, key: string) {
    return (
      <View key={key} style={styles.card}>
        <AnimatedPressable onPress={() => openFile(doc.id)} onLongPress={() => setMenuDoc(doc)} style={styles.cardBody}>
          <FileGlyph icon={doc.icon} kind="doc" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>{doc.title || "Untitled"}</Text>
            <Text numberOfLines={2} style={styles.meta}>
              {meta}
            </Text>
          </View>
        </AnimatedPressable>
        {doc.isFavorite ? <Star size={16} color={colors.warning} fill={colors.warning} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Page menu" onPress={() => setMenuDoc(doc)} hitSlop={8} style={styles.menuBtn}>
          <MoreVertical size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>
    );
  }

  function renderSheetRow(sheet: Sheet, key: string, indent = false) {
    return (
      <AnimatedPressable key={key} onPress={() => openFile(sheet.id)} style={styles.card}>
        {indent ? <View style={styles.chevron} /> : null}
        <View style={styles.sheetBody}>
          <FileGlyph icon={sheet.icon} kind="sheet" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>{sheet.title || "Untitled"}</Text>
            <Text numberOfLines={2} style={styles.meta}>
              {(sheet.rows ?? []).length} rows · {(sheet.columns ?? []).length} cols
              {sheet.updatedAt ? ` · ${timeAgo(sheet.updatedAt)}` : ""}
              {wsById.get(sheet.workspaceId) ? ` · ${wsById.get(sheet.workspaceId)?.name}` : ""}
            </Text>
          </View>
        </View>
        {sheet.isFavorite ? <Star size={16} color={colors.warning} fill={colors.warning} /> : null}
      </AnimatedPressable>
    );
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
            onPress={() => openFile(node.id)}
            onLongPress={() => setMenuDoc(node)}
            style={styles.cardBody}
          >
            <FileGlyph icon={node.icon} kind="doc" />
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

  function renderTemplates() {
    return (
      <>
        {templates.length ? <Text style={styles.section}>Sheet templates</Text> : null}
        {templates.map((template) => (
          <AnimatedPressable key={template.id} onPress={() => openFile(template.id)} style={styles.card}>
            {filter === "all" ? <View style={styles.chevron} /> : null}
            <View style={styles.sheetBody}>
              {template.icon ? (
                <Text style={styles.icon}>{template.icon}</Text>
              ) : (
                <View style={styles.iconBox}>
                  <LayoutTemplate size={20} color={colors.foreground} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title}>{template.name}</Text>
                <Text numberOfLines={2} style={styles.meta}>
                  {template.rows.length} rows · {template.columns.length} cols
                  {(template.tabs?.length ?? 0) > 1 ? ` · ${template.tabs?.length} tabs` : ""}
                </Text>
              </View>
            </View>
          </AnimatedPressable>
        ))}
      </>
    );
  }

  const templatesError = templatesQ.isError ? (
    <Pressable onPress={() => void templatesQ.refetch()}>
      <Text style={styles.templateError}>Could not load templates. Tap to retry.</Text>
    </Pressable>
  ) : null;

  const pageCount = `${docs.length} ${docs.length === 1 ? "page" : "pages"}`;
  const tableCount = `${sheets.length} ${sheets.length === 1 ? "table" : "tables"}`;
  const subtitle =
    filter === "docs"
      ? pageCount
      : filter === "sheets"
        ? `${tableCount} · ${templates.length} ${templates.length === 1 ? "template" : "templates"}`
        : `${pageCount} · ${tableCount}`;

  const refreshing =
    ((showDocs && docsQ.isRefetching) || (showSheets && (sheetsQ.isRefetching || templatesQ.isRefetching))) &&
    !((showDocs && docsQ.isPending) || (showSheets && sheetsQ.isPending));

  function renderList() {
    if (networkCopy) {
      return (
        <EmptyState
          icon={filter === "sheets" ? SheetIcon : FileText}
          title={filter === "docs" ? "Couldn't load docs" : filter === "sheets" ? "Couldn't load sheets" : "Couldn't load files"}
          description={networkCopy}
        />
      );
    }
    if (filter === "docs") {
      if (docs.length === 0) return <EmptyState icon={FileText} title="No docs yet" description="Tap + to start a page." />;
      return (
        <>
          {favoriteDocs.length ? <Text style={styles.section}>Favorites</Text> : null}
          {favoriteDocs.map((doc) => renderDocRow(doc, doc.plainText || timeAgo(doc.updatedAt), `fav-${doc.id}`))}
          <Text style={styles.section}>Pages</Text>
          {tree.map((node) => renderNode(node, 0))}
        </>
      );
    }
    if (filter === "sheets") {
      if (sheets.length === 0 && templates.length === 0 && !templatesQ.isError) {
        return <EmptyState icon={SheetIcon} title="No sheets yet" description="Tap + to create a table, or import a CSV." />;
      }
      return (
        <>
          {templatesError}
          {favoriteSheets.length ? <Text style={styles.section}>Favorites</Text> : null}
          {favoriteSheets.map((sheet) => renderSheetRow(sheet, sheet.id))}
          {restSheets.length ? <Text style={styles.section}>All sheets</Text> : null}
          {restSheets.map((sheet) => renderSheetRow(sheet, `a-${sheet.id}`))}
          {renderTemplates()}
        </>
      );
    }
    if (docs.length === 0 && sheets.length === 0 && templates.length === 0 && !templatesQ.isError) {
      return <EmptyState icon={FileText} title="No files yet" description="Tap + to start a page or a table, or import Markdown or CSV." />;
    }
    return (
      <>
        {templatesError}
        {favoriteEntries.length ? <Text style={styles.section}>Favorites</Text> : null}
        {favoriteEntries.map((entry) =>
          entry.kind === "doc"
            ? renderDocRow(entry.node, entry.node.plainText || timeAgo(entry.node.updatedAt), `fav-${entry.node.id}`)
            : renderSheetRow(entry.sheet, `fav-${entry.sheet.id}`),
        )}
        {allEntries.length ? <Text style={styles.section}>All files</Text> : null}
        {allEntries.map((entry) => (entry.kind === "doc" ? renderNode(entry.node, 0) : renderSheetRow(entry.sheet, `a-${entry.sheet.id}`, true)))}
        {renderTemplates()}
      </>
    );
  }

  return (
    <Screen>
      <MobileHeader
        title="Files"
        subtitle={subtitle}
        actions={
          <>
            <HeaderIconButton
              label={showArchived ? "Show active files" : "Show archived files"}
              active={showArchived}
              onPress={() => setShowArchived((previous) => !previous)}
            >
              {showArchived ? <ArchiveRestore size={20} color={colors.primary} /> : <Archive size={20} color={colors.foreground} />}
            </HeaderIconButton>
            {showDocs ? (
              <HeaderIconButton label="Open today's daily note" onPress={() => void openToday()}>
                <CalendarDays size={20} color={colors.foreground} />
              </HeaderIconButton>
            ) : null}
            <HeaderIconButton
              label={filter === "docs" ? "New doc" : filter === "sheets" ? "New sheet" : "New file"}
              onPress={onNew}
            >
              <FilePlus size={20} color={colors.foreground} />
            </HeaderIconButton>
            <HeaderIconButton
              label={filter === "docs" ? "Import Markdown" : filter === "sheets" ? "Import CSV" : "Import a file"}
              onPress={onImport}
            >
              <Upload size={20} color={colors.foreground} />
            </HeaderIconButton>
          </>
        }
      >
        <View style={styles.headerControls}>
          <SegmentedControl
            options={[
              { label: "All", value: "all" },
              { label: "Docs", value: "docs" },
              { label: "Sheets", value: "sheets" },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </View>
      </MobileHeader>
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (showDocs) void docsQ.refetch();
              if (showSheets) {
                void sheetsQ.refetch();
                void templatesQ.refetch();
              }
            }}
            tintColor={colors.primary}
          />
        }
      >
        {renderList()}
      </ScrollView>
      <BottomSheet open={newOpen} onClose={() => setNewOpen(false)} onClosed={runPendingAction} title="New file">
        <SheetOption
          onSelect={() => {
            pendingAction.current = "doc";
            setNewOpen(false);
          }}
          leading={<FileText size={18} color={colors.mutedForeground} />}
        >
          New doc
        </SheetOption>
        <SheetOption
          onSelect={() => {
            pendingAction.current = "sheet";
            setNewOpen(false);
          }}
          leading={<SheetIcon size={18} color={colors.mutedForeground} />}
        >
          New sheet
        </SheetOption>
      </BottomSheet>
      <BottomSheet open={importOpen} onClose={() => setImportOpen(false)} onClosed={runPendingAction} title="Import">
        <SheetOption
          onSelect={() => {
            pendingAction.current = "markdown";
            setImportOpen(false);
          }}
          leading={<FileText size={18} color={colors.mutedForeground} />}
        >
          Markdown as a doc
        </SheetOption>
        <SheetOption
          onSelect={() => {
            pendingAction.current = "csv";
            setImportOpen(false);
          }}
          leading={<SheetIcon size={18} color={colors.mutedForeground} />}
        >
          CSV as a sheet
        </SheetOption>
      </BottomSheet>
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
            openFile(id);
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
      <NewFileSheet kind={newKind ?? "doc"} open={newKind !== null} onClose={() => setNewKind(null)} workspaceId={spaces[0]?.id} />
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
  sheetBody: { flex: 1, minWidth: 0, minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  iconBox: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  chevron: { width: 32, height: 44, alignItems: "center", justifyContent: "center", overflow: "visible" },
  chevronGlyph: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  menuBtn: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  icon: { fontSize: 22, width: 44, height: 44, lineHeight: 44, borderRadius: 16, overflow: "hidden", textAlign: "center", textAlignVertical: "center", backgroundColor: colors.accent, color: colors.foreground },
  title: { color: colors.foreground, fontSize: 15, lineHeight: 20, fontWeight: "700", flexShrink: 1 },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 4 },
}));
