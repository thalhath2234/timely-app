import { useState } from "react";
import { Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import {
  RULE_LABELS,
  againOptions,
  resetLine,
  rulesFor,
  type MoveDirection,
  type Rule,
  type RuleKind,
  type WatchInput,
} from "@timely/contract/bots";
import BottomSheet from "../ui/BottomSheet";
import { PrimaryButton, Select } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { FieldRow } from "./rows";
import { newRule, numberText, parseAmount, ruleErrors } from "./watchDraft";

const DIRECTIONS: { value: MoveDirection; label: string }[] = [
  { value: "any", label: "Either way" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

type Texts = { threshold: string; percent: string; reset: string; words: string };

const textsOf = (rule: Rule): Texts => ({
  threshold: numberText(rule.threshold),
  percent: numberText(rule.percent),
  reset: numberText(rule.resetPercent || 0.5),
  words: (rule.words ?? []).join(", "),
});

/** The rule the page's fields describe. */
function ruleOf(base: Rule, t: Texts): Rule {
  const out: Rule = { ...base };
  if (base.kind === "below" || base.kind === "above") {
    out.threshold = parseAmount(t.threshold);
    out.resetPercent = parseAmount(t.reset) || 0.5;
  }
  if (base.kind === "move_pct") out.percent = parseAmount(t.percent);
  if (base.kind === "words_appear" || base.kind === "words_disappear" || base.kind === "new_item") {
    out.words = t.words
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
  }
  return out;
}

/**
 * One rule on its own page of the bot sheet: its kind (the ones that fit
 * the watch), then the kind's fields typed in place (the price line, how far
 * back it starts over, the percent, the words). Save hands the rule back.
 */
export function RulePage({
  open,
  rule: initial,
  watch,
  currency,
  isNew,
  canRemove,
  onSave,
  onRemove,
  onClose,
}: {
  open: boolean;
  rule: Rule;
  watch: WatchInput;
  /** The watch's currency, for the price fields and the reset line. */
  currency: string;
  isNew: boolean;
  /** A watch keeps at least one rule. */
  canRemove: boolean;
  /** Resolves once saved; a refusal throws with the server's words. */
  onSave: (rule: Rule) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [base, setBase] = useState<Rule>(initial);
  const [texts, setTexts] = useState<Texts>(() => textsOf(initial));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const rule = ruleOf(base, texts);
  const errors = ruleErrors(rule, watch);
  const set = (patch: Partial<Texts>) => {
    setTexts((t) => ({ ...t, ...patch }));
    setRefused(null);
  };

  const run = async (action: () => void | Promise<void>) => {
    setBusy(true);
    setRefused(null);
    try {
      await action();
    } catch (error) {
      setRefused(error instanceof Error ? error.message : "That didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    <Select
      key="kind"
      trigger="row"
      label="Kind"
      value={base.kind}
      options={rulesFor(watch).map((kind) => ({ value: kind, label: RULE_LABELS[kind] }))}
      onChange={(kind) => {
        if (kind === base.kind) return;
        const next = { ...newRule(kind as RuleKind, watch), id: base.id };
        setBase(next);
        setTexts(textsOf(next));
        setRefused(null);
      }}
    />,
  ];
  let hint: string | null = null;
  switch (base.kind) {
    case "below":
    case "above":
      rows.push(
        <FieldRow
          key="line"
          title={base.kind === "below" ? "Below" : "Above"}
          meta={currency ? `In ${currency}` : undefined}
          value={texts.threshold}
          placeholder="0"
          keyboardType="decimal-pad"
          width={140}
          onChangeText={(threshold) => set({ threshold })}
        />,
        <Select
          key="again"
          trigger="row"
          label="Tell me again"
          value={String(base.stepPercent || 5)}
          options={againOptions(base).map((o) => ({ value: String(o.value), label: o.label }))}
          onChange={(v) => setBase({ ...base, stepPercent: Number(v) })}
        />,
        <FieldRow
          key="reset"
          title="Starts over"
          meta={resetLine(rule, { currency }) ?? undefined}
          value={texts.reset}
          keyboardType="decimal-pad"
          width={72}
          suffix="%"
          onChangeText={(reset) => set({ reset })}
        />,
      );
      break;
    case "move_pct":
      rows.push(
        <FieldRow
          key="pct"
          title="Moves by"
          value={texts.percent}
          placeholder="5"
          keyboardType="decimal-pad"
          width={72}
          suffix="%"
          onChangeText={(percent) => set({ percent })}
        />,
        <Select
          key="way"
          trigger="row"
          label="Which way"
          value={base.direction || "any"}
          options={DIRECTIONS}
          onChange={(v) => setBase({ ...base, direction: v as MoveDirection })}
        />,
      );
      break;
    case "words_appear":
    case "words_disappear":
    case "new_item": {
      const optional = base.kind === "new_item";
      rows.push(
        <FieldRow
          key="words"
          title={optional ? "With words" : "Words"}
          meta={optional ? "Only posts with these words, or leave it empty" : "Separate words with commas"}
          value={texts.words}
          placeholder={optional ? "Any post" : "Add to cart"}
          autoCapitalize="sentences"
          width={160}
          onChangeText={(words) => set({ words })}
        />,
      );
      break;
    }
    default:
      hint = "Any change to what it reads.";
  }

  const line = refused ?? errors[0] ?? hint;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isNew ? "New rule" : "Edit rule"}
      footer={<PrimaryButton label={isNew ? "Add rule" : "Save"} disabled={errors.length > 0} loading={busy} onPress={() => void run(() => onSave(rule))} />}
    >
      <View style={styles.body}>
        <View style={styles.section}>
          <GroupLabel>Tells me when</GroupLabel>
          <ListGroup>{rows}</ListGroup>
          {line ? <Text style={refused ? styles.error : styles.muted}>{line}</Text> : null}
          <GroupHint>Rules cost nothing and never call an AI.</GroupHint>
        </View>
        {!isNew && canRemove ? (
          <ListGroup>
            <ListRow
              title="Remove rule"
              tone="danger"
              leading={<Trash2 size={18} color={colors.destructive} />}
              onPress={() => void run(() => onRemove?.())}
            />
          </ListGroup>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { gap: 16, paddingTop: 4 },
  section: { gap: 6 },
  muted: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  error: { color: colors.destructive, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
}));
