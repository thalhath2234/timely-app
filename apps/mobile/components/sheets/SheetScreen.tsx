import { useAssistantScreen } from "../chat/AssistantProvider";
import { contextChip } from "../../lib/chat/context";
import { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Archive, CheckCircle2, ChevronLeft, Copy, Download, MoreHorizontal, Plus, Sheet as SheetIcon, Smile, Star, Trash2 } from "lucide-react-native";
import Screen from "../ui/Screen";
import MobileHeader from "../ui/MobileHeader";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import EmptyState from "../ui/EmptyState";
import SheetGrid, { type SheetGridHandle } from "./SheetGrid";
import SheetIconPicker from "./SheetIconPicker";
import { useDeleteSheet, useDuplicateSheet, useCreateSheetTemplate, useMaterializeTemplateTab, useSheetQuery, useSheetTemplatesQuery, useUpdateSheet, useWorkspacesQuery } from "../../lib/hooks";
import { saveStatusLabel, useAutosave, useUnsavedLeaveGuard } from "../../lib/autosave";
import { showUndoToast } from "../../lib/toast";
import { shareLocalText } from "../../lib/api/portability";
import {
  addWorkbookTab,
  formatCellDisplay,
  normalizeSheet,
  tabsFromSheet,
  workbookPayload,
} from "../../lib/sheet";
import { sheetToCsv } from "../../lib/sheetCsv";
import { createSheetEvaluator } from "@timely/contract/sheetFormula";
import { timeAgo } from "../../lib/format";
import type { UpdateSheetPayload } from "../../lib/api/sheets";
import type { Sheet, SheetTab } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { systemBottomInset } from "../../lib/systemBottomInset";
import { FILES_TAB, fileHref } from "../../lib/fileRoutes";

export default function SheetScreen({ id }: { id: string }) {
  const sheetQ = useSheetQuery(id);

  if (!id || !sheetQ.isFetchedAfterMount || sheetQ.isLoading) {
    return (
      <Screen>
        <MobileHeader title="Sheet" back large={false} />
        <EmptyState icon={SheetIcon} title="Opening sheet" description="Fetching the latest table…" />
      </Screen>
    );
  }

  if (sheetQ.isError || !sheetQ.data) {
    return (
      <Screen>
        <MobileHeader title="Sheet" back large={false} />
        <EmptyState icon={SheetIcon} title="Sheet not found" description="It may have been deleted." />
      </Screen>
    );
  }

  return <SheetEditor key={sheetQ.data.id} sheet={normalizeSheet(sheetQ.data)} />;
}

function SheetEditor({ sheet }: { sheet: Sheet }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const spaces = useWorkspacesQuery().data ?? [];
  const save = useUpdateSheet();
  const remove = useDeleteSheet();
  const duplicate = useDuplicateSheet();
  const createTemplate = useCreateSheetTemplate();
  const templatesQ = useSheetTemplatesQuery();
  const materializeTab = useMaterializeTemplateTab();
  const initialTabs = tabsFromSheet(sheet);

  const [gridContext, setGridContext] = useState({ selection: "", filter: "", draft: "" });
  const [title, setTitle] = useState(sheet.title);
  const [icon, setIcon] = useState(sheet.icon ?? "");
  const [favorite, setFavorite] = useState(sheet.isFavorite);
  const [tabs, setTabs] = useState<SheetTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0]?.id ?? "");
  const [menu, setMenu] = useState<"more" | "icon" | "delete" | "tab" | "template-tab" | null>(null);
  const [tabDraft, setTabDraft] = useState("");
  const [editingTabId, setEditingTabId] = useState<string | null>(null);

  const { schedule, flush, status, hasUnsavedChanges } = useAutosave<UpdateSheetPayload>((patch) =>
    save.mutateAsync({ id: sheet.id, data: patch }),
  );
  const gridRef = useRef<SheetGridHandle>(null);
  const tabInputRef = useRef<TextInput>(null);
  // Blur before the bottom sheet unmounts its input: Android otherwise moves
  // focus to the first TextInput on screen (the sheet title).
  const closeTabMenu = () => {
    tabInputRef.current?.blur();
    setMenu(null);
  };
  // An active cell draft is unsaved work too: the grid commits it on blur or
  // Enter, but neither fires when the screen is popped. Leaving first commits
  // the draft into the autosave patch and flushes it; the confirmation only
  // appears if that save fails.
  const unsavedLeave = useUnsavedLeaveGuard(() => hasUnsavedChanges() || Boolean(gridContext.draft), {
    beforeLeave: async () => {
      gridRef.current?.commitActiveEdit();
      return flush();
    },
  });
  const tabsRef = useRef(tabs);

  const workspace = spaces.find((w) => w.id === sheet.workspaceId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  useAssistantScreen([
    contextChip("object", title || "Sheet", `sheets/${sheet.id}`),
    contextChip("workspace", workspace?.name || "Workspace", sheet.workspaceId),
    ...(sheet.projectId ? [contextChip("project", "Project", sheet.projectId)] : []),
    ...(activeTab ? [contextChip("sheet-tab", activeTab.name, `sheets/${sheet.id}/tabs/${activeTab.id}`)] : []),
    ...(gridContext.selection ? [contextChip("selection", "Selected cells", gridContext.selection)] : []),
    ...(gridContext.filter ? [contextChip("sheet-filter", "Sheet filter", gridContext.filter)] : []),
    ...(hasUnsavedChanges() || gridContext.draft ? [contextChip("draft", "Unsaved sheet edits", { title, tabId: activeTabId, selectedCells: gridContext.selection, activeCellDraft: gridContext.draft })] : []),
  ]);

  function persistTabs(nextTabs: SheetTab[]) {
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.id === activeTabId) && nextTabs[0]) {
      setActiveTabId(nextTabs[0].id);
    }
    schedule(workbookPayload(nextTabs));
  }

  function handleGridChange(next: Partial<Pick<SheetTab, "columns" | "rows" | "merges">>) {
    if (!activeTab) return;
    persistTabs(
      tabs.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              columns: next.columns ?? tab.columns,
              rows: next.rows ?? tab.rows,
              merges: next.merges ?? tab.merges,
            }
          : tab,
      ),
    );
  }

  async function exportCsv() {
    if (!activeTab) return;
    try {
      const evaluator = createSheetEvaluator(activeTab.columns, activeTab.rows);
      const csv = sheetToCsv(activeTab.columns, activeTab.rows, (col, row) => {
        const column = activeTab.columns[col];
        const format = column ? activeTab.rows[row]?.formats?.[column.id] : undefined;
        return formatCellDisplay(evaluator.displayAt(col, row), format, column?.type);
      });
      const filename = `${(sheet.title || "sheet").replace(/[^\w.-]+/g, "_")}.csv`;
      await shareLocalText(filename, csv, "text/csv");
    } catch (error) {
      Alert.alert("Could not export CSV", error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <Screen>
      <View style={styles.kineticHeader}>
        <Pressable
          accessibilityLabel="Back"
          onPress={() => {
            gridRef.current?.commitActiveEdit();
            router.back();
          }}
          hitSlop={10}
          style={styles.headerIcon}
        >
          <ChevronLeft size={22} color="#F1F3F9" />
        </Pressable>
        <View style={styles.headerIdentity}>
          <TextInput
            value={title}
            placeholder="Untitled"
            placeholderTextColor="#5E6573"
            onChangeText={(value) => {
              setTitle(value);
              schedule({ title: value });
            }}
            onBlur={() => void flush()}
            numberOfLines={1}
            style={styles.headerTitle}
          />
          <View style={styles.headerMeta}>
            <Text numberOfLines={1} style={styles.scopeChip}>{workspace?.name || "Personal"}</Text>
            {status === "saved" ? <CheckCircle2 size={11} color="#38BDF8" /> : null}
            <Text numberOfLines={1} style={styles.savedText}>
              {saveStatusLabel(status) || (sheet.updatedAt ? `Edited ${timeAgo(sheet.updatedAt)}` : "Saved")}
            </Text>
          </View>
        </View>
        {status === "error" ? (
          <Pressable onPress={() => void flush()} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable>
        ) : null}
        <Pressable
          accessibilityLabel={favorite ? "Remove from favorites" : "Add to favorites"}
          onPress={() => {
            setFavorite(!favorite);
            schedule({ isFavorite: !favorite });
          }}
          style={styles.headerIcon}
        >
          <Star size={18} color={favorite ? colors.warning : "#949AA8"} fill={favorite ? colors.warning : "transparent"} />
        </Pressable>
        <Pressable accessibilityLabel="More" onPress={() => setMenu("more")} style={styles.headerIcon}>
          <MoreHorizontal size={20} color="#F1F3F9" />
        </Pressable>
      </View>

      <View style={styles.gridWrap} collapsable={false}>
        {activeTab ? (
          <SheetGrid
            ref={gridRef}
            onAssistantContext={setGridContext}
            key={activeTab.id}
            columns={activeTab.columns}
            rows={activeTab.rows}
            merges={activeTab.merges ?? []}
            onChange={handleGridChange}
          />
        ) : null}
      </View>
      <View style={[styles.tabBarWrap, { paddingBottom: systemBottomInset(insets.bottom) }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTabId(tab.id)}
              onLongPress={() => {
                setEditingTabId(tab.id);
                setTabDraft(tab.name);
                setMenu("tab");
              }}
              style={[styles.tab, tab.id === activeTab?.id && styles.tabOn]}
            >
              <Text style={[styles.tabLabel, tab.id === activeTab?.id && styles.tabLabelOn]}>{tab.name}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityLabel="Add sheet tab"
            onPress={() => {
              if ((templatesQ.data ?? []).length > 0) {
                setMenu("template-tab");
                return;
              }
              const next = addWorkbookTab(tabs);
              setActiveTabId(next[next.length - 1]!.id);
              persistTabs(next);
            }}
            style={styles.tabAdd}
          >
            <Plus size={16} color={colors.mutedForeground} />
          </Pressable>
        </ScrollView>
      </View>

      <BottomSheet open={menu === "more"} onClose={() => setMenu(null)} title="Sheet">
        <SheetOption onSelect={() => setMenu("icon")} leading={<Smile size={18} color={colors.foreground} />}>
          Change icon
        </SheetOption>
        <SheetOption
          onSelect={() => {
            setMenu(null);
            void exportCsv();
          }}
          leading={<Download size={18} color={colors.foreground} />}
        >
          Export CSV
        </SheetOption>
        <SheetOption
          onSelect={() => {
            setMenu(null);
            void (async () => {
              if (!(await flush())) {
                Alert.alert("Could not save template", "Save the sheet and try again.");
                return;
              }
              try {
                const template = await createTemplate.mutateAsync({
                  sheetId: sheet.id,
                  name: title || sheet.title,
                });
                showUndoToast(`Saved template “${template.name}”`);
              } catch (error: unknown) {
                Alert.alert("Could not save template", error instanceof Error ? error.message : "Try again.");
              }
            })();
          }}
          leading={<Copy size={18} color={colors.foreground} />}
        >
          Save as template
        </SheetOption>
        <SheetOption
          onSelect={() => {
            void duplicate.mutateAsync(sheet.id).then((copy) => {
              setMenu(null);
              router.replace(fileHref(copy.id));
            });
          }}
          leading={<Copy size={18} color={colors.foreground} />}
        >
          Duplicate sheet
        </SheetOption>
        <SheetOption
          onSelect={() => {
            const next = !sheet.archivedAt;
            schedule({ archived: next });
            showUndoToast(next ? "Archived" : "Unarchived", () => schedule({ archived: !next }));
            setMenu(null);
          }}
          leading={<Archive size={18} color={colors.mutedForeground} />}
        >
          {sheet.archivedAt ? "Unarchive" : "Archive"}
        </SheetOption>
        <SheetOption
          onSelect={() => setMenu("delete")}
          leading={<Trash2 size={18} color={colors.destructive} />}
        >
          Delete sheet
        </SheetOption>
      </BottomSheet>

      <BottomSheet open={menu === "template-tab"} onClose={() => setMenu(null)} title="New tab">
        <SheetOption
          onSelect={() => {
            const next = addWorkbookTab(tabs);
            setActiveTabId(next[next.length - 1]!.id);
            persistTabs(next);
            setMenu(null);
          }}
          leading={<Plus size={18} color={colors.foreground} />}
        >
          Blank tab
        </SheetOption>
        {(templatesQ.data ?? []).flatMap((template) => {
          const tabsInTemplate = template.tabs && template.tabs.length > 0
            ? template.tabs
            : [{ id: "", name: template.name }];
          return tabsInTemplate.map((tab) => (
            <SheetOption
              key={`${template.id}:${tab.id}`}
              onSelect={() => {
                setMenu(null);
                void materializeTab
                  .mutateAsync({ templateId: template.id, tabId: tab.id || undefined })
                  .then((copy) => {
                    const next = addWorkbookTab(tabsRef.current, copy);
                    setActiveTabId(next[next.length - 1]!.id);
                    persistTabs(next);
                  })
                  .catch((error: unknown) => {
                    setMenu(null);
                    Alert.alert("Could not add tab", error instanceof Error ? error.message : "Try again.");
                  });
              }}
              leading={<SheetIcon size={18} color={colors.foreground} />}
            >
              {tabsInTemplate.length > 1 ? `${template.name} · ${tab.name}` : template.name}
            </SheetOption>
          ));
        })}
      </BottomSheet>

      <SheetIconPicker
        open={menu === "icon"}
        onClose={() => setMenu(null)}
        value={icon}
        onSelect={(choice) => {
          setIcon(choice);
          schedule({ icon: choice });
        }}
      />

      <BottomSheet open={menu === "tab"} onClose={closeTabMenu} title="Tab">
        <TextInput
          ref={tabInputRef}
          value={tabDraft}
          onChangeText={setTabDraft}
          placeholder="Tab name"
          placeholderTextColor={colors.mutedForeground}
          style={styles.tabInput}
        />
        <SheetOption
          onSelect={() => {
            const name = tabDraft.trim();
            if (editingTabId && name) {
              persistTabs(tabs.map((tab) => (tab.id === editingTabId ? { ...tab, name } : tab)));
            }
            closeTabMenu();
          }}
        >
          Rename
        </SheetOption>
        {tabs.length > 1 ? (
          <SheetOption
            onSelect={() => {
              if (editingTabId) persistTabs(tabs.filter((tab) => tab.id !== editingTabId));
              closeTabMenu();
            }}
            leading={<Trash2 size={16} color={colors.destructive} />}
          >
            Delete tab
          </SheetOption>
        ) : null}
      </BottomSheet>

      <ConfirmSheet
        open={menu === "delete"}
        onClose={() => setMenu(null)}
        title="Delete this sheet?"
        message="This workbook and its tabs will be removed."
        onConfirm={() => remove.mutate(sheet.id, { onSuccess: () => router.replace(FILES_TAB) })}
      />
      <ConfirmSheet
        open={unsavedLeave.confirmingLeave}
        onClose={unsavedLeave.stay}
        title="Unsaved changes"
        message="Leave this page without finishing the save?"
        confirmLabel="Leave"
        cancelLabel="Stay"
        onConfirm={unsavedLeave.leave}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  kineticHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: "#111319",
    borderBottomWidth: 1,
    borderBottomColor: "#282C37",
  },
  headerIcon: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  headerIdentity: { flex: 1, minWidth: 0 },
  headerTitle: { color: "#F1F3F9", fontSize: 14, fontWeight: "700", padding: 0, minHeight: 22 },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  scopeChip: { maxWidth: 90, color: "#C4B5FD", backgroundColor: "#2A2445", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, fontSize: 9, fontWeight: "700" },
  savedText: { flexShrink: 1, color: "#5E6573", fontSize: 9 },
  retryButton: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 6, backgroundColor: "#2A2445" },
  retryText: { color: "#C4B5FD", fontSize: 10, fontWeight: "700" },
  metaBlock: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, flexShrink: 0 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { fontSize: 26 },
  title: {
    flex: 1,
    color: colors.foreground,
    fontSize: 24,
    fontWeight: "600",
    paddingTop: 6,
    paddingBottom: 4,
  },
  count: { color: colors.mutedForeground, fontSize: 12, marginTop: 8 },
  gridWrap: { flex: 1, minHeight: 0, backgroundColor: "#111319" },
  tabBarWrap: {
    flexGrow: 0,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: "#282C37",
    backgroundColor: "#191B22",
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  tab: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "transparent",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    justifyContent: "center",
  },
  tabOn: { borderBottomColor: "#7C66DC", backgroundColor: "#1F222B" },
  tabLabel: { color: "#949AA8", fontSize: 11, fontWeight: "500" },
  tabLabelOn: { color: "#F1F3F9" },
  tabAdd: {
    width: 44,
    height: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#282C37",
    alignItems: "center",
    justifyContent: "center",
  },
  tabInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
}));
