import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ListFilter, Sparkles } from "lucide-react-native";
import {
  describeView,
  readingIsListing,
  readViewQuery,
  viewFromAiDraft,
  viewFromReading,
  viewNoun,
  vocabularyFrom,
} from "@timely/contract/viewLanguage";
import { runView } from "@timely/contract/taskQuery";
import { todayInZone } from "@timely/contract/workStatus";
import { useAgentProvidersQuery, useProjectsQuery, useTasksQuery, useWorkingHoursZone, useWorkspacesQuery } from "../../lib/hooks";
import { readyProviders } from "../chat/ModelSheet";
import { readViewWithAi } from "../../lib/api/viewQuery";
import type { TaskViewConfig } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Button } from "../ui/primitives";
import { ViewChips } from "../tasks/ViewRulesBar";

type AiState = { query: string; view?: TaskViewConfig; busy?: boolean; error?: string };

/**
 * Search words read as a list of tasks [natural-language views], as on the
 * web: "show task deadline" shows tasks with a deadline, not keyword hits.
 * Open shows it on the Tasks tab as a Preview; Save as view keeps it. With an
 * AI provider, words the plain reading can't place are read by the AI.
 */
export default function ListingCard({
  query,
  onOpen,
}: {
  query: string;
  onOpen: (view: TaskViewConfig, save: boolean) => void;
}) {
  const tasks = useTasksQuery().data;
  const workspaces = useWorkspacesQuery().data;
  const projects = useProjectsQuery().data;
  const providers = useAgentProvidersQuery().data;
  const timeZone = useWorkingHoursZone();
  const [ai, setAi] = useState<AiState | null>(null);
  const aiReady = readyProviders(providers).length > 0;
  const vocab = useMemo(() => {
    const spaces = workspaces ?? [];
    const seen = new Set<string>();
    const customFields = spaces.flatMap((space) => space.customFields ?? []).filter((field) => {
      if (seen.has(field.id)) return false;
      seen.add(field.id);
      return true;
    });
    return vocabularyFrom({ workspaces: spaces, projects: projects ?? [], customFields });
  }, [workspaces, projects]);
  const today = todayInZone(timeZone);
  const reading = useMemo(() => (query ? readViewQuery(query, vocab, { today }) : undefined), [query, vocab, today]);
  const aiState = ai?.query === query ? ai : undefined;
  const view = useMemo(() => {
    if (aiState?.view) return aiState.view;
    if (!reading || !readingIsListing(reading)) return undefined;
    // The phone has no timeline layout.
    return viewFromReading(reading, "preview", { phone: true, prompt: query });
  }, [aiState?.view, reading, query]);
  const rows = useMemo(() => (view ? runView(tasks ?? [], view, { timeZone }) : []), [view, tasks, timeZone]);

  if (!reading) return null;

  const askAi = () => {
    setAi({ query, busy: true });
    readViewWithAi({ query, today, client: "phone" })
      .then((result) => setAi({ query, view: viewFromAiDraft(result.view, "preview", vocab, { prompt: query }) }))
      .catch((error: Error) => setAi({ query, error: error.message }));
  };

  if (!view) {
    if (!aiReady || query.split(/\s+/).length < 3) return null;
    return (
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel="Make a task view from these words"
        accessibilityState={{ busy: Boolean(aiState?.busy) }}
        onPress={() => (aiState?.busy ? undefined : askAi())}
        style={styles.offer}
      >
        <View style={styles.icon}><Sparkles size={16} color={colors.primary} /></View>
        <View style={styles.body}>
          <Text style={styles.offerTitle}>{aiState?.busy ? "Reading your words…" : "Make a task view from these words"}</Text>
          <Text numberOfLines={2} style={styles.meta}>{aiState?.error ?? "Your AI provider reads what to list, sort and group"}</Text>
        </View>
      </AnimatedPressable>
    );
  }

  const create = reading.createView;
  const noun = viewNoun(view).toLowerCase();
  const count = rows.length;
  const nounFor = (n: number) => (n === 1 ? noun.replace(/s$/, "") : noun);
  const chips = describeView(view, vocab).filter((chip) => chip.kind !== "layout" || view.renderMode !== "list");

  return (
    <View style={styles.card} testID="search-listing">
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={create ? `Create view ${view.name}` : `Show ${count} ${nounFor(count)}: ${view.name}`}
        onPress={() => onOpen(view, create)}
        style={styles.head}
      >
        <View style={styles.icon}>
          {aiState?.view ? <Sparkles size={16} color={colors.primary} /> : <ListFilter size={16} color={colors.primary} />}
        </View>
        <View style={styles.body}>
          <Text numberOfLines={2} style={styles.title}>
            {create ? `Create view “${view.name}”` : view.name}
          </Text>
          <Text style={styles.meta}>
            {count ? `${count} ${nounFor(count)}${create ? " now" : ""}` : "Nothing matches yet; it will fill as work comes in"}
          </Text>
        </View>
      </AnimatedPressable>
      <ViewChips chips={chips} wrap />
      {rows.length > 0 ? (
        <View style={styles.rows}>
          {rows.slice(0, 3).map((task) => (
            <Text key={task.id} numberOfLines={1} style={styles.rowText}>
              {task.name || "Untitled"}
            </Text>
          ))}
          {count > 3 ? <Text style={styles.more}>and {count - 3} more</Text> : null}
        </View>
      ) : null}
      {aiState?.error ? <Text style={styles.meta}>{aiState.error}</Text> : null}
      <View style={styles.actions}>
        {aiReady && reading.leftover.length > 0 && !aiState?.view ? (
          <Button
            label="Read with AI"
            variant="ghost"
            size="sm"
            icon={<Sparkles size={16} color={colors.mutedForeground} />}
            loading={aiState?.busy}
            onPress={askAi}
          />
        ) : null}
        {create ? (
          <Button label="Create view" size="sm" onPress={() => onOpen(view, true)} />
        ) : (
          <>
            <Button label="Save as view" variant="outline" size="sm" onPress={() => onOpen(view, true)} />
            <Button label="Open" size="sm" onPress={() => onOpen(view, false)} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0 },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  rows: { gap: 4, paddingLeft: 2 },
  rowText: { color: colors.foreground, fontSize: 13 },
  more: { color: colors.mutedForeground, fontSize: 12 },
  actions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 },
  offer: { borderRadius: 14, backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  offerTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
}));
