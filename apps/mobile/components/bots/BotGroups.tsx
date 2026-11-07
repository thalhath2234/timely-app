import { useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { ChartCandlestick, Globe, Rss, Sparkles, Trash2, X } from "lucide-react-native";
import {
  BOT_LIMITS,
  EMPTY_BOTS_SUMMARY,
  HOW_SMART,
  RULE_LABELS,
  SMART_HINT,
  aiHint,
  againOptions,
  defaultMinutes,
  floorHint,
  formatMoney,
  intervalLabel,
  intervalOptions,
  lessonsHint,
  resetLine,
  rulesFor,
  smartOptions,
  sourceLabel,
  watchKindLine,
  watchCurrency,
  watchTitle,
  type BotInput,
  type BotKind,
  type BotSettings,
  type BotsSummary,
  type KnowledgeView,
  type Lesson,
  type MoveDirection,
  type Rule,
  type WatchInput,
  type WatchKind,
  type WatchView,
} from "@timely/contract/bots";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { Button, Select } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow, ListSubLabel, SwitchRow } from "../settings/SettingsList";
import { useForgetLesson } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { BotMark, watchSite, type SiteIcons } from "./BotMark";
import { Pill } from "./Pill";
import { RulePage } from "./RulePage";
import { KnowledgeRow } from "./KnowledgePage";
import { EditPill, IconTile } from "./rows";
import { WatchPage } from "./WatchPage";
import { blankWatch, newRule, withWatches } from "./watchDraft";

/**
 * How an edit is kept. "page": from a page's Save, which waits for it and
 * shows a refusal on the page; "quick": a pick or a switch, kept at once.
 */
export type CommitHow = "page" | "quick";
export type Commit = (next: BotInput, how: CommitHow) => void | Promise<void>;

/** A watch row's name: its site ("amazon.in"), or "BTC-USD · Coinbase" for a price. */
function watchName(w: WatchInput, view?: WatchView): string {
  if (w.kind === "price") return watchTitle(view ?? w);
  return (view ? view.site : "") || watchSite(w) || (w.kind === "feed" ? "New feed" : "New page");
}

/** "Product price · ₹27,499", "Feed · not read yet", or why it fails. */
function watchMeta(w: WatchInput, view: WatchView | undefined): string {
  const what = w.kind === "price" ? sourceLabel(w.source ?? "stock") : watchKindLine(w);
  if (!view) return `${what} · not read yet`;
  if (view.health.code !== "working" && view.health.code !== "new" && view.health.line) return `${what} · ${view.health.line}`;
  if (!view.lastReadingAt) return `${what} · not read yet`;
  return view.summary ? `${what} · ${view.summary}` : what;
}

const KINDS: { kind: WatchKind; label: string; meta: string; Icon: typeof Globe }[] = [
  { kind: "page", label: "A page", meta: "Its text, one part of it, or a shop price", Icon: Globe },
  { kind: "feed", label: "A feed", meta: "New posts in an RSS or Atom feed", Icon: Rss },
  { kind: "price", label: "A price", meta: "A stock or a coin, from a free source", Icon: ChartCandlestick },
];

const DIRECTIONS: { value: MoveDirection; label: string }[] = [
  { value: "any", label: "Either way" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

const pct = (p: number | undefined) => `${p == null ? "…" : Number(p.toFixed(2))}%`;

type WatchEdit = { index: number; watch: WatchInput };
type RuleEdit = { watch: number; rule: number; value: Rule };

/**
 * The bot sheet's editable groups, the same on an open bot and a new one:
 * Watches, Schedule, Tells me when (How smart, "Set up AI" while no AI
 * provider is ready, Knowledge on an AI-judged bot, then each watch's rules,
 * under the watch's name when there are two or more) and Alerts. A row
 * opens its page in the sheet (a watch, a rule, How smart); a pick or a
 * switch is kept at once. Everything comes back through `onCommit`.
 */
export function BotGroups({
  draft,
  views,
  icons,
  alertsToday,
  hasKey,
  onAddKey,
  onCommit,
  unsaved = false,
  openWatch,
  summary,
  aiChecksToday,
  knowledgeView,
  onSetUpAi,
}: {
  draft: BotInput;
  /** The saved watches by id, for their readings, currency and health. */
  views?: Map<string, WatchView>;
  icons?: SiteIcons;
  alertsToday?: number;
  hasKey: (source: string) => boolean;
  onAddKey: () => void;
  onCommit: Commit;
  /** A new bot: nothing is saved until Create. */
  unsaved?: boolean;
  /** A watch id to open on arrival, once its watch is in the draft. */
  openWatch?: string;
  /**
   * The board's summary: whether an AI provider is ready, and which.
   * Undefined while it loads, when AI is neither offered nor marked Needs AI.
   */
  summary?: Pick<BotsSummary, "ai">;
  /** The saved bot's AI checks today, for the hint. */
  aiChecksToday?: number;
  /** The saved bot's knowledge, with its title and whether it is missing. */
  knowledgeView?: KnowledgeView | null;
  /** Opens Settings › Agent, where an AI provider is added. */
  onSetUpAi?: () => void;
}) {
  const [watchEdit, setWatchEdit] = useState<WatchEdit | null>(null);
  // Open the asked-for watch once, when it is in the draft: a fix such as
  // "Pick the part again" lands on that watch's page, not the sheet's top.
  const [opened, setOpened] = useState<string | null>(null);
  if (openWatch && opened !== openWatch) {
    const index = draft.watches.findIndex((w) => w.id === openWatch);
    if (index >= 0) {
      setOpened(openWatch);
      setWatchEdit({ index, watch: draft.watches[index] });
    }
  }
  const [ruleEdit, setRuleEdit] = useState<RuleEdit | null>(null);
  const [smart, setSmart] = useState(false);
  const watches = draft.watches;
  const viewOf = (w: WatchInput) => (w.id ? views?.get(w.id) : undefined);
  const currencyOf = (w: WatchInput) => {
    const view = viewOf(w);
    return view ? watchCurrency(view) : (w.currency ?? "");
  };

  const setRules = (index: number, rules: Rule[], how: CommitHow) =>
    onCommit({ ...draft, watches: watches.map((w, i) => (i === index ? { ...w, rules } : w)) }, how);

  // ── Watches ──
  const watchRows: ReactElement[] =
    watches.length === 0
      ? KINDS.map(({ kind, label, meta, Icon }) => (
          <ListRow
            key={kind}
            title={label}
            meta={meta}
            leading={
              <IconTile>
                <Icon size={16} color={colors.mutedForeground} />
              </IconTile>
            }
            onPress={() => setWatchEdit({ index: 0, watch: blankWatch(kind) })}
          />
        ))
      : [
          ...watches.map((w, index) => {
            const view = viewOf(w);
            return (
              <ListRow
                key={w.id ?? `new-${index}`}
                title={watchName(w, view)}
                meta={watchMeta(w, view)}
                leading={<BotMark watches={[view ?? w]} size={24} icons={icons} badge={false} />}
                onPress={() => setWatchEdit({ index, watch: w })}
              />
            );
          }),
          ...(watches.length < BOT_LIMITS.maxWatches
            ? [<ListRow key="add" title="Add watch" tone="add" onPress={() => setWatchEdit({ index: watches.length, watch: blankWatch("page") })} />]
            : []),
        ];

  // ── Schedule ──
  const every = draft.intervalMinutes || defaultMinutes(watches);
  const intervals = intervalOptions(watches, every).map((m) => ({ value: String(m), label: intervalLabel(m) }));

  // ── Rules ──
  const totalRules = watches.reduce((n, w) => n + (w.rules?.length ?? 0), 0);
  const rulesAside =
    watches.length === 0 ? undefined : watches.length === 1 ? `${totalRules} of ${BOT_LIMITS.maxRulesPerWatch} rules` : `${totalRules} rules`;
  const mode = draft.judgeMode || "rules";
  const smartLabel = HOW_SMART.find((h) => h.id === mode)?.label ?? "Rules only";
  // While the board loads AI is neither offered nor marked Needs AI.
  const options = smartOptions(summary ?? EMPTY_BOTS_SUMMARY);
  const needsAi = !!summary && options.some((o) => o.id === "ai" && o.tag === "Needs AI");
  const ruleRows: ReactElement[] = [
    <ListRow key="smart" title="How smart" trailing={smartLabel} chevron onPress={() => setSmart(true)} />,
  ];
  if (needsAi && onSetUpAi) {
    ruleRows.push(
      <ListRow
        key="setup-ai"
        title="Set up AI"
        meta="Add an AI provider so AI can judge"
        leading={<Sparkles size={18} color={colors.mutedForeground} />}
        onPress={onSetUpAi}
      />,
    );
  }
  if (mode === "ai") {
    ruleRows.push(
      <KnowledgeRow
        key="knowledge"
        value={draft.knowledge}
        view={knowledgeView}
        onChange={(knowledge) => onCommit({ ...draft, knowledge }, "quick")}
      />,
    );
  }
  if (watches.length === 0) {
    ruleRows.push(<ListRow key="none" title="Rules" trailing="Add a watch first" disabled />);
  }
  watches.forEach((w, wi) => {
    const view = viewOf(w);
    const currency = currencyOf(w);
    const rules = w.rules ?? [];
    const open = (ri: number) => setRuleEdit({ watch: wi, rule: ri, value: rules[ri] });
    if (watches.length > 1) ruleRows.push(<ListSubLabel key={`sub-${wi}`}>{view ? watchTitle(view) : watchTitle(w)}</ListSubLabel>);
    rules.forEach((rule, ri) => {
      const key = `${wi}-${rule.id ?? ri}`;
      const set = (patch: Partial<Rule>) => setRules(wi, rules.map((r, i) => (i === ri ? { ...r, ...patch } : r)), "quick");
      switch (rule.kind) {
        case "below":
        case "above":
          ruleRows.push(
            <ListRow
              key={`${key}-line`}
              title={RULE_LABELS[rule.kind]}
              trailing={<EditPill>{rule.threshold == null ? "Set a price" : formatMoney(rule.threshold, currency)}</EditPill>}
              chevron={false}
              onPress={() => open(ri)}
            />,
            <Select
              key={`${key}-again`}
              trigger="row"
              label="Tell me again"
              value={String(rule.stepPercent || 5)}
              options={againOptions(rule).map((o) => ({ value: String(o.value), label: o.label }))}
              onChange={(v) => set({ stepPercent: Number(v) })}
            />,
            <ListRow
              key={`${key}-reset`}
              title="Starts over"
              meta={resetMeta(rule, currency)}
              trailing={<EditPill>{pct(rule.resetPercent || 0.5)}</EditPill>}
              chevron={false}
              onPress={() => open(ri)}
            />,
          );
          break;
        case "move_pct":
          ruleRows.push(
            <ListRow key={`${key}-line`} title="Moves by" trailing={<EditPill>{pct(rule.percent)}</EditPill>} chevron={false} onPress={() => open(ri)} />,
            <Select
              key={`${key}-way`}
              trigger="row"
              label="Which way"
              value={rule.direction || "any"}
              options={DIRECTIONS}
              onChange={(v) => set({ direction: v as MoveDirection })}
            />,
          );
          break;
        case "words_appear":
        case "words_disappear":
        case "new_item": {
          const words = (rule.words ?? []).join(", ");
          ruleRows.push(
            <ListRow
              key={`${key}-line`}
              title={RULE_LABELS[rule.kind]}
              trailing={<EditPill>{words || (rule.kind === "new_item" ? "Any post" : "Add words")}</EditPill>}
              chevron={false}
              onPress={() => open(ri)}
            />,
          );
          break;
        }
        default:
          ruleRows.push(<ListRow key={`${key}-line`} title={RULE_LABELS.any_change} meta="Any change to what it reads" onPress={() => open(ri)} />);
      }
    });
    if (rules.length < BOT_LIMITS.maxRulesPerWatch) {
      ruleRows.push(
        <ListRow
          key={`${wi}-add`}
          title={watches.length > 1 ? `Add rule to ${watchName(w, view)}` : "Add rule"}
          tone="add"
          onPress={() => setRuleEdit({ watch: wi, rule: rules.length, value: newRule(rulesFor(w)[0], w) })}
        />,
      );
    }
  });

  const editingWatch = watchEdit ? watchEdit : null;
  const editingRule = ruleEdit ? ruleEdit : null;
  const ruleWatch = editingRule ? watches[editingRule.watch] : undefined;

  return (
    <>
      <View style={styles.section}>
        <GroupLabel aside={watches.length ? `${watches.length} of ${BOT_LIMITS.maxWatches}` : "Pick one to start"}>Watches</GroupLabel>
        <ListGroup>{watchRows}</ListGroup>
        {watches.length === 0 ? <GroupHint>A bot can watch up to {BOT_LIMITS.maxWatches} things. Add more after the first.</GroupHint> : null}
      </View>

      <View style={styles.section}>
        <GroupLabel>Schedule</GroupLabel>
        <ListGroup>
          <Select
            trigger="row"
            label="Checks every"
            value={String(every)}
            options={intervals}
            onChange={(v) => onCommit({ ...draft, intervalMinutes: Number(v) }, "quick")}
          />
          <ListRow
            title="Only during"
            disabled
            trailing={
              <View style={styles.later}>
                <Pill>Later</Pill>
                <Text style={styles.value}>Always</Text>
              </View>
            }
          />
        </ListGroup>
        {watches.length ? <GroupHint>{floorHint(watches)}</GroupHint> : null}
      </View>

      <View style={styles.section}>
        <GroupLabel aside={rulesAside}>Tells me when</GroupLabel>
        <ListGroup>{ruleRows}</ListGroup>
        {/* Loading: say nothing about a provider not known yet. */}
        {summary || mode !== "ai" ? <GroupHint>{aiHint({ judgeMode: mode, aiChecksToday }, summary ?? EMPTY_BOTS_SUMMARY)}</GroupHint> : null}
      </View>

      <AlertsGroup draft={draft} alertsToday={alertsToday} unsaved={unsaved} onCommit={onCommit} />

      {editingWatch ? (
        <WatchPage
          key={`w-${editingWatch.index}`}
          open
          watch={editingWatch.watch}
          view={viewOf(editingWatch.watch)}
          isNew={editingWatch.index >= watches.length}
          isLast={!unsaved && watches.length <= 1}
          unsaved={unsaved}
          hasKey={hasKey}
          onAddKey={onAddKey}
          onClose={() => setWatchEdit(null)}
          onSave={async (w) => {
            const isNew = editingWatch.index >= watches.length;
            const next = isNew ? [...watches, w] : watches.map((x, i) => (i === editingWatch.index ? w : x));
            await onCommit(withWatches(draft, next), "page");
            setWatchEdit(null);
          }}
          onRemove={async () => {
            await onCommit(withWatches(draft, watches.filter((_, i) => i !== editingWatch.index)), "page");
            setWatchEdit(null);
          }}
        />
      ) : null}

      {editingRule && ruleWatch ? (
        <RulePage
          key={`r-${editingRule.watch}-${editingRule.rule}`}
          open
          rule={editingRule.value}
          watch={ruleWatch}
          currency={currencyOf(ruleWatch)}
          isNew={editingRule.rule >= (ruleWatch.rules?.length ?? 0)}
          canRemove={(ruleWatch.rules?.length ?? 0) > 1}
          onClose={() => setRuleEdit(null)}
          onSave={async (rule) => {
            const rules = ruleWatch.rules ?? [];
            const next = editingRule.rule >= rules.length ? [...rules, rule] : rules.map((r, i) => (i === editingRule.rule ? rule : r));
            await setRules(editingRule.watch, next, "page");
            setRuleEdit(null);
          }}
          onRemove={async () => {
            await setRules(
              editingRule.watch,
              (ruleWatch.rules ?? []).filter((_, i) => i !== editingRule.rule),
              "page",
            );
            setRuleEdit(null);
          }}
        />
      ) : null}

      <BottomSheet open={smart} onClose={() => setSmart(false)} title="How smart">
        <View style={styles.options}>
          {options.map((h) => (
            <SheetOption
              key={h.id}
              selected={mode === h.id}
              // The bot's own mode stays picked even when AI is not ready now.
              disabled={h.disabled && h.id !== mode}
              trailing={h.tag && (summary || h.id !== "ai") ? <Pill>{h.tag}</Pill> : undefined}
              onSelect={() => {
                setSmart(false);
                if (h.id === mode || (h.id !== "rules" && h.id !== "ai")) return;
                // A new rules-only bot is not created with hidden knowledge.
                onCommit({ ...draft, judgeMode: h.id, ...(h.id === "rules" && unsaved ? { knowledge: null } : {}) }, "quick");
              }}
            >
              {h.label}
            </SheetOption>
          ))}
          <GroupHint>{SMART_HINT}</GroupHint>
        </View>
      </BottomSheet>
    </>
  );
}

/**
 * Alerts: where the bot tells you (Desktop, Phone, Urgent), each kept at
 * once. A watch bot shows today's count against the daily cap; a brief,
 * whose sends are not capped, leaves it out.
 */
export function AlertsGroup({
  draft,
  alertsToday,
  unsaved,
  onCommit,
}: {
  draft: BotInput;
  alertsToday?: number;
  unsaved?: boolean;
  onCommit: Commit;
}) {
  const alerts: BotSettings = { desktop: draft.desktop ?? true, phone: draft.phone ?? true, urgent: draft.urgent ?? false };
  const setAlert = (key: keyof BotSettings, value: boolean) => onCommit({ ...draft, [key]: value }, "quick");
  return (
    <View style={styles.section}>
      <GroupLabel aside={alertsToday == null ? undefined : `${alertsToday} of ${BOT_LIMITS.alertsPerDay} today`}>Alerts</GroupLabel>
      <ListGroup>
        <SwitchRow title="Desktop" value={alerts.desktop} onChange={(v) => setAlert("desktop", v)} />
        <SwitchRow title="Phone" value={alerts.phone} onChange={(v) => setAlert("phone", v)} />
        <SwitchRow title="Urgent" meta="Rings through quiet hours" value={alerts.urgent} onChange={(v) => setAlert("urgent", v)} />
      </ListGroup>
      {unsaved && draft.kind !== "brief" ? (
        <GroupHint>Up to {BOT_LIMITS.alertsPerDay} alerts a day. After that you get one “and 2 more today”.</GroupHint>
      ) : null}
    </View>
  );
}

/** "0.5% back above your line (₹25,125)": the reset line, shortened for a row's meta. */
function resetMeta(rule: Rule, currency: string): string | undefined {
  return resetLine(rule, { currency })?.replace(/^Once the price is /, "");
}

/**
 * Lessons: what the bot was taught by Useful and Not useful answers. The AI
 * judge (or a brief's AI writer) reads them; rules ignore them. Each one can
 * be forgotten.
 */
export function LessonsGroup({ bot, botId, lessons }: { bot: { kind?: BotKind }; botId: string; lessons: Lesson[] }) {
  const forget = useForgetLesson();
  return (
    <View style={styles.section}>
      <GroupLabel aside={`${lessons.length} of ${BOT_LIMITS.maxLessons}`}>Lessons</GroupLabel>
      <ListGroup>
        {lessons.length === 0 ? (
          <ListRow key="none" title="Nothing learned yet" disabled />
        ) : (
          lessons.map((lesson) => (
            <View key={lesson.id} style={styles.lesson}>
              <Text style={styles.lessonText}>{lesson.text}</Text>
              <Button
                label="Forget"
                variant="ghost"
                size="sm"
                iconOnly
                icon={<X size={16} color={colors.mutedForeground} />}
                loading={forget.isPending && forget.variables?.lessonId === lesson.id}
                onPress={() =>
                  forget.mutate(
                    { botId, lessonId: lesson.id },
                    { onError: (error) => useToastStore.getState().show(error.message) },
                  )
                }
              />
            </View>
          ))
        )}
      </ListGroup>
      <GroupHint>{lessonsHint(bot)}</GroupHint>
    </View>
  );
}

/** Delete bot, a danger row; the sheet asks first. */
export function DeleteRow({ onPress }: { onPress: () => void }) {
  return (
    <ListGroup>
      <ListRow title="Delete bot" tone="danger" leading={<Trash2 size={18} color={colors.destructive} />} onPress={onPress} />
    </ListGroup>
  );
}

/** The views of a bot's watches by id. */
export function useWatchViews(watches: WatchView[] | undefined) {
  return useMemo(() => new Map<string, WatchView>((watches ?? []).map((w) => [w.id, w])), [watches]);
}

const styles = createThemedStyleSheet((colors) => ({
  section: { gap: 6 },
  later: { flexDirection: "row", alignItems: "center", gap: 8 },
  value: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  options: { gap: 2, paddingTop: 4 },
  lesson: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  lessonText: { flex: 1, minWidth: 0, color: colors.mutedForeground, fontSize: 15, fontWeight: "500" },
}));
