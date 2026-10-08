import { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, ChevronLeft, LayoutTemplate, MoreHorizontal, Plus, Smile, Trash2 } from "lucide-react-native";
import Screen from "../ui/Screen";
import MobileHeader from "../ui/MobileHeader";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import EmptyState from "../ui/EmptyState";
import SheetGrid, { type SheetGridHandle } from "./SheetGrid";
import SheetIconPicker from "./SheetIconPicker";
import { useCreateSheet, useDeleteSheetTemplate, useSheetTemplatesQuery, useUpdateSheetTemplate } from "../../lib/hooks";
import { saveStatusLabel, useAutosave, useUnsavedLeaveGuard } from "../../lib/autosave";
import { addWorkbookTab, tabsFromSheet, workbookPayload } from "../../lib/sheet";
import { timeAgo } from "../../lib/format";
import type { UpdateSheetTemplatePayload } from "../../lib/api/sheets";
import type { SheetTab, SheetTemplate } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { systemBottomInset } from "../../lib/systemBottomInset";
import { FILES_TAB, fileHref } from "../../lib/fileRoutes";

export default function SheetTemplateScreen({ id }: { id: string }) {
  const templatesQ = useSheetTemplatesQuery();
  const template = templatesQ.data?.find((item) => item.id === id);

  if (!template) {
    return (
      <Screen>
        <MobileHeader title="Template" back large={false} />
        <EmptyState
          icon={LayoutTemplate}
          title={templatesQ.isLoading ? "Opening template" : "Template unavailable"}
          description={templatesQ.isError ? "Could not load templates." : templatesQ.isLoading ? "Fetching your template…" : "It may have been deleted."}
        />
      </Screen>
    );
  }

  return <TemplateEditor key={template.id} template={template} />;
}

function TemplateEditor({ template }: { template: SheetTemplate }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const save = useUpdateSheetTemplate();
  const remove = useDeleteSheetTemplate();
  const createSheet = useCreateSheet();
  const [initialTabs] = useState(() => tabsFromSheet({ ...template, title: template.name }));

  const [draft, setDraft] = useState("");
  const [name, setName] = useState(template.name);
  const [icon, setIcon] = useState(template.icon ?? "");
  const [tabs, setTabs] = useState<SheetTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0]?.id ?? "");
  const [menu, setMenu] = useState<"more" | "icon" | "delete" | "tab" | null>(null);
  const [tabDraft, setTabDraft] = useState("");
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  // Set while the template is being deleted so leaving does not try to save it.
  const [deleted, setDeleted] = useState(false);

  const { schedule, flush, status, hasUnsavedChanges } = useAutosave<UpdateSheetTemplatePayload>((patch) =>
    save.mutateAsync({ id: template.id, data: patch }),
  );
  const gridRef = useRef<SheetGridHandle>(null);
  const tabInputRef = useRef<TextInput>(null);
  // Blur before the bottom sheet unmounts its input: Android otherwise moves
  // focus to the first TextInput on screen (the template name).
  const closeTabMenu = () => {
    tabInputRef.current?.blur();
    setMenu(null);
  };
  // Same as the sheet editor: leaving commits the active cell draft and flushes
  // it; the confirmation only appears if that save fails.
  const unsavedLeave = useUnsavedLeaveGuard(() => !deleted && (hasUnsavedChanges() || Boolean(draft)), {
    beforeLeave: async () => {
      gridRef.current?.commitActiveEdit();
      return flush();
    },
  });
  const tabsRef = useRef(tabs);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

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
      tabsRef.current.map((tab) =>
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

  async function createFromTemplate() {
    // The new sheet is copied server-side, so pending edits must land first.
    gridRef.current?.commitActiveEdit();
    if (!(await flush())) {
      Alert.alert("Could not save template", "Save the template changes and try again.");
      return;
    }
    try {
      const sheet = await createSheet.mutateAsync({ templateId: template.id });
      router.replace(fileHref(sheet.id));
    } catch (error) {
      Alert.alert("Could not create sheet", error instanceof Error ? error.message : "Try again.");
    }
  }

  async function deleteTemplate() {
    // Turn the leave guard off first (it re-renders while the request runs) so
    // navigating away afterwards does not try to save the deleted template.
    setDeleted(true);
    try {
      await remove.mutateAsync(template.id);
    } catch (error) {
      setDeleted(false);
      Alert.alert("Could not delete template", error instanceof Error ? error.message : "Try again.");
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace(FILES_TAB);
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
        <Pressable accessibilityLabel="Change icon" onPress={() => setMenu("icon")} style={styles.headerIcon}>
          {icon ? <Text style={styles.headerEmoji}>{icon}</Text> : <Smile size={18} color="#949AA8" />}
        </Pressable>
        <View style={styles.headerIdentity}>
          <TextInput
            value={name}
            placeholder="Untitled template"
            placeholderTextColor="#5E6573"
            accessibilityLabel="Template name"
            onChangeText={(value) => {
              setName(value);
              schedule({ name: value });
            }}
            onBlur={() => void flush()}
            numberOfLines={1}
            style={styles.headerTitle}
          />
          <View style={styles.headerMeta}>
            <Text numberOfLines={1} style={styles.scopeChip}>Template</Text>
            {status === "saved" ? <CheckCircle2 size={11} color="#38BDF8" /> : null}
            <Text numberOfLines={1} style={styles.savedText}>
              {saveStatusLabel(status) || (template.updatedAt ? `Edited ${timeAgo(template.updatedAt)}` : "Saved")}
            </Text>
          </View>
        </View>
        {status === "error" ? (
          <Pressable onPress={() => void flush()} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable>
        ) : null}
        <Pressable accessibilityLabel="More" onPress={() => setMenu("more")} style={styles.headerIcon}>
          <MoreHorizontal size={20} color="#F1F3F9" />
        </Pressable>
      </View>

      <View style={styles.gridWrap} collapsable={false}>
        {activeTab ? (
          <SheetGrid
            ref={gridRef}
            onAssistantContext={(context) => setDraft(context.draft)}
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
            accessibilityLabel="Add template tab"
            onPress={() => {
              const next = addWorkbookTab(tabsRef.current);
              setActiveTabId(next[next.length - 1]!.id);
              persistTabs(next);
            }}
            style={styles.tabAdd}
          >
            <Plus size={16} color={colors.mutedForeground} />
          </Pressable>
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          disabled={createSheet.isPending}
          onPress={() => void createFromTemplate()}
          style={[styles.createButton, createSheet.isPending && styles.disabled]}
        >
          <Plus size={18} color={colors.primaryForeground} />
          <Text style={styles.createText}>{createSheet.isPending ? "Creating…" : "New sheet from template"}</Text>
        </Pressable>
      </View>

      <BottomSheet open={menu === "more"} onClose={() => setMenu(null)} title="Template">
        <SheetOption onSelect={() => setMenu("icon")} leading={<Smile size={18} color={colors.foreground} />}>
          Change icon
        </SheetOption>
        <SheetOption
          onSelect={() => {
            setMenu(null);
            void createFromTemplate();
          }}
          leading={<Plus size={18} color={colors.foreground} />}
        >
          New sheet from template
        </SheetOption>
        <SheetOption onSelect={() => setMenu("delete")} leading={<Trash2 size={18} color={colors.destructive} />}>
          Delete template
        </SheetOption>
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
            const tabName = tabDraft.trim();
            if (editingTabId && tabName) {
              persistTabs(tabsRef.current.map((tab) => (tab.id === editingTabId ? { ...tab, name: tabName } : tab)));
            }
            closeTabMenu();
          }}
        >
          Rename
        </SheetOption>
        {tabs.length > 1 ? (
          <SheetOption
            onSelect={() => {
              if (editingTabId) persistTabs(tabsRef.current.filter((tab) => tab.id !== editingTabId));
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
        title="Delete this template?"
        message="Sheets already made from it stay."
        onConfirm={deleteTemplate}
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
  headerEmoji: { fontSize: 20 },
  headerIdentity: { flex: 1, minWidth: 0 },
  headerTitle: { color: "#F1F3F9", fontSize: 14, fontWeight: "700", padding: 0, minHeight: 22 },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  scopeChip: { maxWidth: 90, color: "#C4B5FD", backgroundColor: "#2A2445", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, fontSize: 9, fontWeight: "700" },
  savedText: { flexShrink: 1, color: "#5E6573", fontSize: 9 },
  retryButton: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 6, backgroundColor: "#2A2445" },
  retryText: { color: "#C4B5FD", fontSize: 10, fontWeight: "700" },
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
  createButton: {
    minHeight: 46,
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  createText: { color: colors.primaryForeground, fontWeight: "600" },
  disabled: { opacity: 0.6 },
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
