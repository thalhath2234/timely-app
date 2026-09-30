import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useRef, useState } from "react";
import { Keyboard, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ArrowUpRight, CalendarDays, FileText, FolderKanban, LayoutGrid, ListTodo, Plus, Search as SearchIcon, Table2, X } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { useSearchQuery } from "../../../lib/hooks";
import type { SearchKind } from "../../../lib/api/search";
import { requestQuickAdd } from "../../../lib/quickAddIntent";
import { sheetHref } from "../../../lib/sheet";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

const categories = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "sheet", label: "Sheets", icon: Table2 },
  { id: "doc", label: "Docs", icon: FileText },
  { id: "task", label: "Tasks", icon: ListTodo },
  { id: "project", label: "Projects", icon: FolderKanban },
  { id: "event", label: "Events", icon: CalendarDays },
] as const;
type Category = typeof categories[number]["id"];

const destinations: Record<Exclude<Category, "all">, Href> = {
  sheet: "/(app)/(tabs)/sheets",
  doc: "/(app)/(tabs)/docs",
  task: "/(app)/(tabs)/tasks",
  project: "/(app)/projects",
  event: "/(app)/(tabs)/calendar",
};

function hrefFor(kind: SearchKind, id: string): Href {
  if (kind === "sheet") return sheetHref(id);
  const encoded = encodeURIComponent(id);
  if (kind === "task") return `/(app)/tasks/${encoded}`;
  if (kind === "doc") return `/(app)/docs/${encoded}`;
  if (kind === "event") return `/(app)/events/${encoded}`;
  if (kind === "project") return `/(app)/projects/${encoded}`;
  return "/(app)/(tabs)/tasks";
}

export default function SearchTab() {
  const router = useRouter();
  const input = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  useAssistantScreen([contextChip("search", "Search results", { query, category })]);
  const results = useSearchQuery(query);
  const trimmed = query.trim();
  const current = results.query === trimmed;
  const hits = trimmed && current ? (results.data ?? []).filter((hit) => category === "all" || hit.kind === category) : [];
  const pending = !!trimmed && (!current || results.isFetching);
  const failed = !!trimmed && current && results.isError;

  function navigate(href: Href) {
    Keyboard.dismiss();
    router.push(href);
  }

  const commands = categories.flatMap((tab) => {
    if (tab.id === "all") return [];
    const kind = tab.id;
    const noun = kind === "doc" ? "document" : kind;
    const destination = kind === "event" ? "calendar" : tab.label.toLowerCase();
    return [
      {
        id: `create-${kind}`, kind, title: `Create ${noun}`, description: `Start a new ${noun}`, icon: Plus,
        run: () => {
          Keyboard.dismiss();
          if (kind === "project") router.push(destinations.project);
          else requestQuickAdd({ kind });
        },
      },
      {
        id: `goto-${kind}`, kind, title: `Go to ${destination}`, description: `Open your ${destination}`, icon: tab.icon,
        run: () => navigate(destinations[kind]),
      },
    ];
  }).filter((command) => (category === "all" || command.kind === category)
    && `${command.title} ${command.description}`.toLowerCase().includes(trimmed.toLowerCase()));

  return (
    <Screen>
      <MobileHeader title="Search" subtitle="Your workspace, one command away" />
      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <SearchIcon size={22} color={colors.primary} />
          <TextInput
            ref={input}
            style={styles.input}
            value={query}
            onChangeText={(text) => { setQuery(text); scroll.current?.scrollTo({ y: 0, animated: false }); }}
            placeholder="Search or run a command…"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            accessibilityLabel="Search or run a command"
          />
          {query ? (
            <AnimatedPressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => { setQuery(""); input.current?.focus(); }} style={styles.clearButton}>
              <X size={19} color={colors.mutedForeground} />
            </AnimatedPressable>
          ) : null}
        </View>
      </View>
      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.tabs}>
          {categories.map((tab) => {
            const selected = category === tab.id;
            const Icon = tab.icon;
            return (
              <AnimatedPressable key={tab.id} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
                onPress={() => { setCategory(tab.id); scroll.current?.scrollTo({ y: 0, animated: false }); }}
                style={[styles.tab, selected && styles.tabSelected]}>
                <Icon size={16} color={selected ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{tab.label}</Text>
              </AnimatedPressable>
            );
          })}
        </ScrollView>
      </View>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.results}>
        <View accessibilityLiveRegion="polite">
          {pending ? <Text style={styles.status}>Searching your workspace…</Text> : failed ? (
            <View style={styles.error}>
              <Text style={styles.status}>Couldn’t search your workspace. Commands are still available.</Text>
              <AnimatedPressable accessibilityRole="button" onPress={() => void results.refetch()} style={styles.retry}>
                <Text style={styles.tabLabelSelected}>Retry search</Text>
              </AnimatedPressable>
            </View>
          ) : trimmed && hits.length === 0 ? (
            <EmptyState icon={SearchIcon} title="No matching items" description="Try another keyword or category." />
          ) : hits.length > 0 ? <Text style={styles.sectionHeading}>{hits.length} {hits.length === 1 ? "result" : "results"}</Text> : null}
        </View>
        {hits.map((hit) => {
          const Icon = categories.find((tab) => tab.id === hit.kind)?.icon ?? FileText;
          return (
            <AnimatedPressable key={`${hit.kind}:${hit.id}`} accessibilityRole="button" accessibilityLabel={`Open ${hit.kind}: ${hit.title || "Untitled"}`}
              onPress={() => navigate(hrefFor(hit.kind, hit.id))} style={styles.row}>
              <View style={styles.resultIcon}><Icon size={20} color={colors.primary} /></View>
              <View style={styles.resultContent}>
                <Text style={styles.kind}>{hit.kind}</Text>
                <Text numberOfLines={2} style={styles.title}>{hit.title || "Untitled"}</Text>
                {hit.snippet ? <Text numberOfLines={2} style={styles.snippet}>{hit.snippet}</Text> : null}
              </View>
              <ArrowUpRight size={16} color={colors.mutedForeground} />
            </AnimatedPressable>
          );
        })}
        {commands.length > 0 && <Text style={styles.sectionHeading}>Quick actions</Text>}
        {commands.map((command) => (
          <AnimatedPressable key={command.id} accessibilityRole="button" accessibilityLabel={command.title} onPress={command.run} style={styles.row}>
            <View style={styles.commandIcon}><command.icon size={20} color={colors.primary} /></View>
            <View style={styles.resultContent}>
              <Text style={styles.title}>{command.title}</Text>
              <Text style={styles.snippet}>{command.description}</Text>
            </View>
            <ArrowUpRight size={16} color={colors.mutedForeground} />
          </AnimatedPressable>
        ))}
        {!trimmed && <Text style={styles.hint}>Search by name or meaning. Try “create” or “go to” for quick actions.</Text>}
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  searchWrap: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  searchBox: { minHeight: 56, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 6 },
  input: { flex: 1, color: colors.foreground, fontSize: 16, minHeight: 52, paddingVertical: 0 },
  clearButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  tabsWrap: { borderBottomWidth: 1, borderBottomColor: colors.border },
  tabs: { paddingHorizontal: 16, paddingBottom: 12, gap: 6 },
  tab: { minHeight: 48, paddingHorizontal: 14, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 6 },
  tabSelected: { backgroundColor: colors.accent },
  tabLabel: { color: colors.mutedForeground, fontSize: 13, fontWeight: "600" },
  tabLabelSelected: { color: colors.primary, fontWeight: "700" },
  results: { paddingHorizontal: 16, paddingTop: 8, gap: 8, paddingBottom: 140 },
  sectionHeading: { color: colors.mutedForeground, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, paddingTop: 12, paddingBottom: 4 },
  row: { borderRadius: 16, backgroundColor: colors.card, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  resultIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  commandIcon: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  resultContent: { flex: 1, minWidth: 0 },
  kind: { color: colors.primary, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 3 },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  snippet: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 3 },
  status: { color: colors.mutedForeground, fontSize: 13, paddingVertical: 12 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18, paddingVertical: 12 },
  error: { gap: 4 },
  retry: { minHeight: 48, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.accent },
}));
