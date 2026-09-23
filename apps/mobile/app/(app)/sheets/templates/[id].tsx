import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LayoutTemplate, Plus } from "lucide-react-native";
import Screen from "../../../../components/ui/Screen";
import MobileHeader from "../../../../components/ui/MobileHeader";
import EmptyState from "../../../../components/ui/EmptyState";
import { useCreateSheet, useSheetTemplatesQuery } from "../../../../lib/hooks";
import { routeParam, sheetHref } from "../../../../lib/sheet";
import type { SheetTab, SheetTemplate } from "../../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../../lib/theme";
import { systemBottomInset } from "../../../../lib/systemBottomInset";

function templateTabs(template: SheetTemplate): SheetTab[] {
  return template.tabs?.length
    ? template.tabs
    : [{ id: template.id, name: template.name, columns: template.columns, rows: template.rows, merges: template.merges ?? [] }];
}

export default function TemplateScreen() {
  const id = routeParam(useLocalSearchParams<{ id: string | string[] }>().id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const templatesQ = useSheetTemplatesQuery();
  const createSheet = useCreateSheet();
  const [activeTabId, setActiveTabId] = useState("");
  const template = templatesQ.data?.find((item) => item.id === id);
  const tabs = template ? templateTabs(template) : [];
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  async function create() {
    if (!template) return;
    try {
      const sheet = await createSheet.mutateAsync({ templateId: template.id });
      router.replace(sheetHref(sheet.id));
    } catch (error) {
      Alert.alert("Could not create sheet", error instanceof Error ? error.message : "Try again.");
    }
  }

  if (!template) {
    return <Screen><MobileHeader title="Template" back large={false} /><EmptyState icon={LayoutTemplate} title={templatesQ.isLoading ? "Opening template" : "Template unavailable"} description={templatesQ.isError ? "Could not load templates." : templatesQ.isLoading ? "Fetching your template…" : "It may have been deleted."} /></Screen>;
  }

  return (
    <Screen>
      <MobileHeader title={template.name} subtitle="Template preview" back large={false} />
      <View style={[styles.content, { paddingBottom: systemBottomInset(insets.bottom) + 12 }]}>
        {tabs.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabStrip} contentContainerStyle={styles.tabContent}>
            {tabs.map((tab) => <Pressable key={tab.id} onPress={() => setActiveTabId(tab.id)} style={[styles.tab, activeTab?.id === tab.id && styles.activeTab]}><Text style={styles.tabText}>{tab.name}</Text></Pressable>)}
          </ScrollView>
        ) : null}
        {activeTab ? (
          <ScrollView horizontal style={styles.gridScroll}>
            <ScrollView nestedScrollEnabled contentContainerStyle={styles.grid}>
              <View style={styles.row}><Text style={[styles.cell, styles.rowNumber]} />{activeTab.columns.map((column) => <Text key={column.id} style={[styles.cell, styles.heading]} numberOfLines={1}>{column.name}</Text>)}</View>
              {activeTab.rows.map((row, index) => <View key={row.id} style={styles.row}><Text style={[styles.cell, styles.rowNumber]}>{index + 1}</Text>{activeTab.columns.map((column) => <Text key={column.id} style={styles.cell} numberOfLines={1}>{row.cells?.[column.id] ?? ""}</Text>)}</View>)}
            </ScrollView>
          </ScrollView>
        ) : null}
        <Pressable accessibilityRole="button" disabled={createSheet.isPending} onPress={() => void create()} style={[styles.createButton, createSheet.isPending && styles.disabled]}>
          <Plus size={18} color={colors.primaryForeground} />
          <Text style={styles.createText}>{createSheet.isPending ? "Creating…" : "New sheet from template"}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = createThemedStyleSheet((theme) => ({
  content: { flex: 1, padding: 12, gap: 10 },
  tabStrip: { flexGrow: 0 },
  tabContent: { gap: 6 },
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.card },
  activeTab: { backgroundColor: theme.primary },
  tabText: { color: theme.foreground, fontSize: 13 },
  gridScroll: { flex: 1 },
  grid: { paddingBottom: 12 },
  row: { flexDirection: "row" },
  cell: { width: 140, minHeight: 40, borderWidth: 0.5, borderColor: theme.border, paddingHorizontal: 8, paddingVertical: 9, color: theme.foreground, fontSize: 13 },
  heading: { backgroundColor: theme.card, fontWeight: "600" },
  rowNumber: { width: 42, backgroundColor: theme.card, color: theme.mutedForeground, textAlign: "center" },
  createButton: { minHeight: 46, borderRadius: 10, backgroundColor: theme.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  createText: { color: theme.primaryForeground, fontWeight: "600" },
  disabled: { opacity: 0.6 },
}));
