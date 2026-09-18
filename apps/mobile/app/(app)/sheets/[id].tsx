import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Archive, Copy, Download, MoreHorizontal, Plus, Sheet as SheetIcon, Smile, Star, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import EmptyState from "../../../components/ui/EmptyState";
import SheetGrid from "../../../components/sheets/SheetGrid";
import { useDeleteSheet, useDuplicateSheet, useSheetQuery, useUpdateSheet, useWorkspacesQuery } from "../../../lib/hooks";
import { saveStatusLabel, useAutosave, useUnsavedLeaveGuard } from "../../../lib/autosave";
import { showUndoToast } from "../../../lib/toast";
import { shareLocalText } from "../../../lib/api/portability";
import {
  addWorkbookTab,
  formatCellDisplay,
  normalizeSheet,
  routeParam,
  SHEET_ICON_CHOICES,
  sheetHref,
  tabsFromSheet,
  workbookPayload,
} from "../../../lib/sheet";
import { sheetToCsv } from "../../../lib/sheetCsv";
import { createSheetEvaluator } from "../../../lib/sheetFormula";
import { timeAgo } from "../../../lib/format";
import type { UpdateSheetPayload } from "../../../lib/api/sheets";
import type { Sheet, SheetTab } from "../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function SheetDetailScreen() {
  const id = routeParam(useLocalSearchParams<{ id: string | string[] }>().id);
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
  const spaces = useWorkspacesQuery().data ?? [];
  const save = useUpdateSheet();
  const remove = useDeleteSheet();
  const duplicate = useDuplicateSheet();
  const initialTabs = tabsFromSheet(sheet);

  const [title, setTitle] = useState(sheet.title);
  const [icon, setIcon] = useState(sheet.icon ?? "");
  const [favorite, setFavorite] = useState(sheet.isFavorite);
  const [description, setDescription] = useState(sheet.description ?? "");
  const [tabs, setTabs] = useState<SheetTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0]?.id ?? "");
  const [showDescription, setShowDescription] = useState(
    Boolean(sheet.description?.trim()) || Boolean(sheet.descriptionRich),
  );
  const [menu, setMenu] = useState<"more" | "icon" | "delete" | "tab" | null>(null);
  const [tabDraft, setTabDraft] = useState("");
  const [editingTabId, setEditingTabId] = useState<string | null>(null);

  const { schedule, flush, status, hasUnsavedChanges } = useAutosave<UpdateSheetPayload>((patch) =>
    save.mutateAsync({ id: sheet.id, data: patch }),
  );
  useUnsavedLeaveGuard(hasUnsavedChanges);

  const workspace = spaces.find((w) => w.id === sheet.workspaceId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  function persistTabs(nextTabs: SheetTab[]) {
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
      <MobileHeader
        title={workspace?.name || "Sheet"}
        subtitle={saveStatusLabel(status) || (sheet.updatedAt ? `Edited ${timeAgo(sheet.updatedAt)}` : undefined)}
        back
        large={false}
        actions={
          <View style={styles.actions}>
            {status === "error" ? (
              <Pressable onPress={() => void flush()} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <Text style={{ color: colors.primary, fontWeight: "600" }}>Retry</Text>
              </Pressable>
            ) : null}
            <HeaderIconButton
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              active={favorite}
              onPress={() => {
                setFavorite(!favorite);
                schedule({ isFavorite: !favorite });
              }}
            >
              <Star size={20} color={favorite ? colors.warning : colors.mutedForeground} fill={favorite ? colors.warning : "transparent"} />
            </HeaderIconButton>
            <HeaderIconButton label="More" onPress={() => setMenu("more")}>
              <MoreHorizontal size={22} color={colors.foreground} />
            </HeaderIconButton>
          </View>
        }
      />

      <View style={styles.metaBlock}>
        <View style={styles.titleRow}>
          <Pressable accessibilityLabel="Change icon" onPress={() => setMenu("icon")} style={styles.iconBtn}>
            {icon ? <Text style={styles.icon}>{icon}</Text> : <Smile size={22} color={colors.mutedForeground} />}
          </Pressable>
          <TextInput
            value={title}
            placeholder="Untitled"
            placeholderTextColor={colors.mutedForeground}
            onChangeText={(value) => {
              setTitle(value);
              schedule({ title: value });
            }}
            onBlur={() => void flush()}
            style={styles.title}
          />
        </View>
        <Text style={styles.count}>
          {(activeTab?.rows.length ?? 0)} rows · {(activeTab?.columns.length ?? 0)} columns
          {tabs.length > 1 ? ` · ${tabs.length} tabs` : ""}
          {!showDescription ? (
            <Text style={styles.addDesc} onPress={() => setShowDescription(true)}>
              {" · "}Add description
            </Text>
          ) : null}
        </Text>
        {showDescription ? (
          <TextInput
            value={description}
            onChangeText={(value) => {
              setDescription(value);
              schedule({ description: value });
            }}
            onBlur={() => void flush()}
            placeholder="Add a description…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={styles.description}
          />
        ) : null}
      </View>

      <View style={styles.gridWrap}>
        {activeTab ? (
          <SheetGrid
            key={activeTab.id}
            columns={activeTab.columns}
            rows={activeTab.rows}
            merges={activeTab.merges ?? []}
            onChange={handleGridChange}
          />
        ) : null}
      </View>
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
            const next = addWorkbookTab(tabs);
            setActiveTabId(next[next.length - 1]!.id);
            persistTabs(next);
          }}
          style={styles.tabAdd}
        >
          <Plus size={16} color={colors.mutedForeground} />
        </Pressable>
      </ScrollView>

      <BottomSheet open={menu === "more"} onClose={() => setMenu(null)} title="Sheet">
        <SheetOption onSelect={() => setMenu("icon")} leading={<Smile size={18} color={colors.foreground} />}>
          Change icon
        </SheetOption>
        {!showDescription ? (
          <SheetOption
            onSelect={() => {
              setShowDescription(true);
              setMenu(null);
            }}
          >
            Add description
          </SheetOption>
        ) : null}
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
            void duplicate.mutateAsync(sheet.id).then((copy) => {
              setMenu(null);
              router.replace(sheetHref(copy.id) as never);
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

      <BottomSheet open={menu === "icon"} onClose={() => setMenu(null)} title="Icon">
        <View style={styles.iconGrid}>
          {SHEET_ICON_CHOICES.map((choice) => (
            <Pressable
              key={choice}
              onPress={() => {
                setIcon(choice);
                schedule({ icon: choice });
                setMenu(null);
              }}
              style={[styles.iconChoice, choice === icon && styles.iconChoiceOn]}
            >
              <Text style={styles.icon}>{choice}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => {
            setIcon("");
            schedule({ icon: "" });
            setMenu(null);
          }}
          style={styles.removeIcon}
        >
          <Text style={styles.removeIconText}>Remove icon</Text>
        </Pressable>
      </BottomSheet>

      <BottomSheet open={menu === "tab"} onClose={() => setMenu(null)} title="Tab">
        <TextInput
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
            setMenu(null);
          }}
        >
          Rename
        </SheetOption>
        {tabs.length > 1 ? (
          <SheetOption
            onSelect={() => {
              if (editingTabId) persistTabs(tabs.filter((tab) => tab.id !== editingTabId));
              setMenu(null);
            }}
            leading={<Trash2 size={16} color={colors.destructive} />}
          >
            Delete tab
          </SheetOption>
        ) : null}
      </BottomSheet>

      <BottomSheet open={menu === "delete"} onClose={() => setMenu(null)} title="Delete this sheet?">
        <View style={styles.deleteRow}>
          <Pressable onPress={() => setMenu(null)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => remove.mutate(sheet.id, { onSuccess: () => router.replace("/(app)/(tabs)/sheets") })}
            disabled={remove.isPending}
            style={styles.deleteBtn}
          >
            <Trash2 size={16} color="#fff" />
            <Text style={styles.deleteText}>{remove.isPending ? "Deleting…" : "Delete"}</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  actions: { flexDirection: "row", alignItems: "center" },
  metaBlock: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
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
  addDesc: { color: colors.primary, fontWeight: "600" },
  description: {
    marginTop: 10,
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: "top",
  },
  gridWrap: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  iconChoice: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconChoiceOn: { backgroundColor: colors.accent },
  removeIcon: {
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  removeIconText: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  deleteRow: { flexDirection: "row", gap: 8, paddingTop: 4 },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  deleteBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.destructive,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  deleteText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tab: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.accent },
  tabLabel: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  tabLabelOn: { color: colors.foreground },
  tabAdd: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
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
