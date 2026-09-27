import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Check, ChevronDown, Grid2X2, Layers3, Plus, Search } from "lucide-react-native";
import BottomSheet from "../ui/BottomSheet";
import AnimatedPressable from "../ui/AnimatedPressable";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export type CalendarScopeOption = { id: string; title: string; color?: string | null; count: number };

export default function CalendarScopeSelect({
  kind,
  value,
  options,
  onChange,
  onCreate,
}: {
  kind: "spaces" | "projects";
  value: string | null;
  options: CalendarScopeOption[];
  onChange: (id: string | null) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const allLabel = kind === "spaces" ? "All spaces" : "All projects";
  const chosen = options.find((option) => option.id === value);
  const visible = options.filter((option) => option.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const Icon = kind === "spaces" ? Grid2X2 : Layers3;

  return (
    <View style={styles.root}>
      <AnimatedPressable accessibilityRole="button" accessibilityLabel={chosen?.title ?? allLabel} accessibilityState={{ expanded: open }} onPress={() => { setSearch(""); setOpen(true); }} style={styles.trigger}>
        {chosen?.color ? <View style={[styles.dot, { backgroundColor: chosen.color }]} /> : <Icon size={15} color={colors.primary} />}
        <Text numberOfLines={1} style={styles.triggerText}>{chosen?.title ?? allLabel}</Text>
        <ChevronDown size={15} color={colors.mutedForeground} />
      </AnimatedPressable>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={allLabel}>
        <Text style={styles.subtitle}>{kind === "projects" ? "Filter calendar by active project scope" : `${options.length} ${options.length === 1 ? "space" : "spaces"}`}</Text>
        {kind === "projects" ? <View style={styles.search}><Search size={17} color={colors.mutedForeground} /><TextInput value={search} onChangeText={setSearch} placeholder="Search projects" placeholderTextColor={colors.mutedForeground} style={styles.searchInput} /></View> : null}
        <AnimatedPressable accessibilityRole="button" accessibilityState={{ selected: value === null }} onPress={() => { onChange(null); setOpen(false); }} style={[styles.option, value === null && styles.optionActive]}>
          <View style={styles.allIcon}><Icon size={16} color={colors.primary} /></View>
          <Text style={styles.optionTitle}>{allLabel}</Text>
          {value === null ? <View style={styles.selected}><Text style={styles.selectedText}>Selected</Text><Check size={12} color={colors.primaryForeground} /></View> : null}
        </AnimatedPressable>
        {visible.map((option) => <AnimatedPressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: value === option.id }} onPress={() => { onChange(option.id); setOpen(false); }} style={[styles.option, value === option.id && styles.optionActive]}>
          <View style={[styles.dot, { backgroundColor: option.color || colors.primary }]} />
          <Text numberOfLines={2} style={styles.optionTitle}>{option.title}</Text>
          {value === option.id ? <View style={styles.selected}><Text style={styles.selectedText}>Selected</Text><Check size={12} color={colors.primaryForeground} /></View> : <Text style={styles.count}>{option.count} {kind === "spaces" ? option.count === 1 ? "project" : "projects" : option.count === 1 ? "task" : "tasks"}</Text>}
        </AnimatedPressable>)}
        <AnimatedPressable accessibilityRole="button" onPress={() => { setOpen(false); onCreate(); }} style={styles.create}><Plus size={16} color={colors.primary} /><Text style={styles.createText}>{kind === "spaces" ? "New space" : "Create new project"}</Text></AnimatedPressable>
      </BottomSheet>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: { width: "100%", minWidth: 0 },
  trigger: { minHeight: 46, borderRadius: 15, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11 },
  triggerText: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 12, fontWeight: "700" },
  dot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  subtitle: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  search: { flexDirection: "row", alignItems: "center", minHeight: 46, gap: 8, borderRadius: 15, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 12 },
  searchInput: { flex: 1, color: colors.foreground, fontSize: 14, paddingVertical: 8 },
  option: { flexDirection: "row", alignItems: "center", minHeight: 50, gap: 10, borderRadius: 14, paddingHorizontal: 12, marginBottom: 4 },
  optionActive: { backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.primary },
  allIcon: { width: 25, height: 25, borderRadius: 8, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  optionTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  count: { color: colors.mutedForeground, fontSize: 10, fontFamily: "SpaceMono", flexShrink: 0 },
  selected: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, backgroundColor: colors.primary, paddingHorizontal: 7, paddingVertical: 4 },
  selectedText: { color: colors.primaryForeground, fontSize: 10, fontWeight: "800" },
  create: { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 48, gap: 7, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, marginTop: 10 },
  createText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
}));
