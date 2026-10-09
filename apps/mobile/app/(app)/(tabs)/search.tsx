import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useRef, useState } from "react";
import { Keyboard, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ArrowUpRight, LayoutGrid, Plus, Search as SearchIcon, Sparkles, X } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { useSearchQuery, useSmartSearchQuery } from "../../../lib/hooks";
import type { SearchHit, SmartCategory } from "../../../lib/api/search";
import { requestQuickAdd } from "../../../lib/quickAddIntent";
import { FILES_TAB } from "../../../lib/fileRoutes";
import { hrefFor } from "../../../lib/searchRoutes";
import { SEARCH_KIND_ICONS, searchKindIcon } from "../../../components/search/kindIcon";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

const categories = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "sheet", label: "Sheets", icon: SEARCH_KIND_ICONS.sheet },
  { id: "doc", label: "Docs", icon: SEARCH_KIND_ICONS.doc },
  { id: "task", label: "Tasks", icon: SEARCH_KIND_ICONS.task },
  { id: "project", label: "Projects", icon: SEARCH_KIND_ICONS.project },
  { id: "event", label: "Events", icon: SEARCH_KIND_ICONS.event },
] as const;
type Category = typeof categories[number]["id"];

const destinations: Record<Exclude<Category, "all">, Href> = {
  sheet: { pathname: FILES_TAB, params: { filter: "sheets" } },
  doc: { pathname: FILES_TAB, params: { filter: "docs" } },
  task: "/(app)/(tabs)/tasks",
  project: "/(app)/projects",
  event: "/(app)/(tabs)/calendar",
};

function nounFor(kind: Exclude<Category, "all">) {
  return kind === "doc" ? "document" : kind;
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
  const [showHidden, setShowHidden] = useState<string | null>(null);
  // Smart suggestions rerank the same debounced text; they land a few seconds
  // after the plain results and only apply while the query hasn't changed.
  const smart = useSmartSearchQuery(results.query);
  const smartData = trimmed && current && smart.query === trimmed ? smart.data : undefined;
  const ranked = smartData?.hits != null;
  const inCategory = (hit: SearchHit) => category === "all" || hit.kind === category;
  const hits = trimmed && current ? (ranked ? smartData.hits ?? [] : results.data ?? []).filter(inCategory) : [];
  const hidden = ranked ? smartData.hidden.filter(inCategory) : [];
  const hiddenShown = hidden.length > 0 && showHidden === trimmed;
  const smartCategory = category === "all" && smartData?.category ? categories.find((tab) => tab.id === smartData.category) : undefined;
  const smartCreate = smartData?.create;
  const pending = !!trimmed && (!current || results.isFetching);
  const failed = !!trimmed && current && results.isError;

  function navigate(href: Href) {
    Keyboard.dismiss();
    router.push(href);
  }

  function create(kind: SmartCategory, title?: string) {
    Keyboard.dismiss();
    if (kind === "project") router.push(destinations.project);
    else requestQuickAdd(title ? { kind, title } : { kind });
  }

  const commands = categories.flatMap((tab) => {
    if (tab.id === "all") return [];
    const kind = tab.id;
    const noun = nounFor(kind);
    const destination = kind === "event" ? "calendar" : tab.label.toLowerCase();
    return [
      {
        id: `create-${kind}`, kind, title: `Create ${noun}`, description: `Start a new ${noun}`, icon: Plus,
        run: () => create(kind),
      },
      {
        id: `goto-${kind}`, kind, title: `Go to ${destination}`, description: `Open your ${destination}`, icon: tab.icon,
        run: () => navigate(destinations[kind]),
      },
    ];
  }).filter((command) => (category === "all" || command.kind === category)
    && `${command.title} ${command.description}`.toLowerCase().includes(trimmed.toLowerCase()));
  // A query that reads like a command ("make a budget sheet") leads the actions.
  if (smartCreate && (category === "all" || category === smartCreate.kind)) {
    const noun = nounFor(smartCreate.kind);
    commands.unshift({
      id: `smart-create-${smartCreate.kind}`, kind: smartCreate.kind, title: `Create ${noun} “${smartCreate.title}”`,
      description: `Start a new ${noun} with this title`, icon: Plus,
      run: () => create(smartCreate.kind, smartCreate.title),
    });
  }

  function renderHit(hit: SearchHit) {
    const Icon = searchKindIcon(hit.kind);
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
  }

  const hiddenToggle = hidden.length > 0 && !hiddenShown ? (
    <View style={styles.hiddenRow}>
      <Text style={styles.hiddenText}>
        {hits.length === 0 ? "No good matches." : `${hidden.length} weak ${hidden.length === 1 ? "match" : "matches"} hidden`}
      </Text>
      <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Show ${hidden.length} weak ${hidden.length === 1 ? "match" : "matches"}`}
        onPress={() => setShowHidden(trimmed)} hitSlop={8} style={styles.hiddenShow}>
        <Text style={styles.tabLabelSelected}>Show</Text>
      </AnimatedPressable>
    </View>
  ) : null;

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
        {!pending && !failed && smartCategory ? (
          <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Looking for ${smartCategory.label}? Show only ${smartCategory.label.toLowerCase()}`}
            onPress={() => { setCategory(smartCategory.id); scroll.current?.scrollTo({ y: 0, animated: false }); }}
            style={styles.suggestChip}>
            <Sparkles size={14} color={colors.primary} />
            <Text style={styles.suggestText}>Looking for {smartCategory.label}?</Text>
          </AnimatedPressable>
        ) : null}
        <View accessibilityLiveRegion="polite">
          {pending ? <Text style={styles.status}>Searching your workspace…</Text> : failed ? (
            <View style={styles.error}>
              <Text style={styles.status}>Couldn’t search your workspace. Commands are still available.</Text>
              <AnimatedPressable accessibilityRole="button" onPress={() => void results.refetch()} style={styles.retry}>
                <Text style={styles.tabLabelSelected}>Retry search</Text>
              </AnimatedPressable>
            </View>
          ) : trimmed && hits.length === 0 && hidden.length > 0 ? (
            hiddenToggle ?? <Text style={styles.status}>No good matches.</Text>
          ) : trimmed && hits.length === 0 ? (
            <EmptyState icon={SearchIcon} title="No matching items" description="Try another keyword or category." />
          ) : hits.length > 0 ? <Text style={styles.sectionHeading}>{hits.length} {hits.length === 1 ? "result" : "results"}</Text> : null}
        </View>
        {hits.map(renderHit)}
        {hits.length > 0 ? hiddenToggle : null}
        {hiddenShown ? hidden.map(renderHit) : null}
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
  hiddenRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  hiddenText: { color: colors.mutedForeground, fontSize: 12 },
  hiddenShow: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  suggestChip: { alignSelf: "flex-start", minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 18, backgroundColor: colors.accent },
  suggestText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  retry: { minHeight: 48, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.accent },
}));
