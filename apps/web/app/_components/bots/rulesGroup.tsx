"use client";

import type { ReactElement, ReactNode } from "react";
import { X } from "lucide-react";
import {
  BOT_LIMITS,
  HOW_SMART,
  RULE_LABELS,
  againOptions,
  readingKind,
  resetLine,
  rulesFor,
  watchCurrency,
  watchTitle,
  type Rule,
  type RuleKind,
  type WatchInput,
  type WatchView,
} from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
  ListSubLabel,
  rowValueClass,
} from "@/app/_components/_ui/groupedList";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import Select from "@/app/_components/_ui/select";
import { cn } from "@/app/utils/cn";
import { EditPill, moneyAffixes, parseAmount } from "./editPill";

/**
 * The rules a watch gets when saved with none, as the API's DefaultRules:
 * a page alerts on any change, a feed on new posts, a shop price on a 5%
 * drop and a market price on a 5% move either way.
 */
export function defaultRules(w: Pick<WatchInput, "kind" | "read">): Rule[] {
  switch (readingKind(w)) {
    case "feed":
      return [{ kind: "new_item" }];
    case "price":
      return [
        {
          kind: "move_pct",
          percent: 5,
          direction: w.kind === "page" ? "down" : "any",
        },
      ];
  }
  return [{ kind: "any_change" }];
}

/** A rule of `kind` with a starting value, so it reads well before it is filled in. */
function newRule(kind: RuleKind, w: Pick<WatchInput, "kind">): Rule {
  switch (kind) {
    case "below":
    case "above":
      return { kind, stepPercent: 5, resetPercent: 0.5 };
    case "move_pct":
      return {
        kind,
        percent: 5,
        direction: w.kind === "page" ? "down" : "any",
      };
    case "words_appear":
    case "words_disappear":
      return { kind, words: [] };
  }
  return { kind };
}

const DIRECTIONS = [
  { value: "any", label: "Either way" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

const pctText = (p: number | undefined) =>
  p == null ? "" : String(Number(p.toFixed(2)));
const groupedText = (n: number | undefined) =>
  n == null ? "" : n.toLocaleString("en-US", { maximumFractionDigits: 8 });

/** One watch's rule rows, flat, so the group can draw hairlines between them. */
function ruleRows({
  watch,
  view,
  onChange,
  keyBase,
  flag,
}: {
  watch: WatchInput;
  view?: WatchView;
  onChange: (rules: Rule[], how: "text" | "now") => void;
  keyBase: string;
  /** Mark unfinished values; off until the group has an error to show, so a fresh starter is not red before anything is typed. */
  flag: boolean;
}): ReactElement[] {
  const rules = watch.rules ?? [];
  const currency = view ? watchCurrency(view) : (watch.currency ?? "");
  const money = moneyAffixes(currency);
  const set = (index: number, patch: Partial<Rule>, how: "text" | "now") =>
    onChange(
      rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
      how,
    );
  const remove = (index: number) =>
    rules.length > 1 ? (
      <Button
        variant="ghost"
        size="sm"
        icon
        aria-label="Remove rule"
        onClick={() =>
          onChange(
            rules.filter((_, i) => i !== index),
            "now",
          )
        }
      >
        <X />
      </Button>
    ) : null;

  const rows: ReactElement[] = [];
  rules.forEach((rule, index) => {
    // By place, not id: a new rule gets its id when the save comes back,
    // and a key change then would remount a pill the person is typing in.
    const key = `${keyBase}-${index}-${rule.kind}`;
    switch (rule.kind) {
      case "below":
      case "above": {
        rows.push(
          <ListRow key={`${key}-line`} label={RULE_LABELS[rule.kind]}>
            <EditPill
              aria-label={RULE_LABELS[rule.kind]}
              value={groupedText(rule.threshold)}
              before={money.before}
              after={money.after}
              placeholder="0"
              numeric
              invalid={flag && !(rule.threshold != null && rule.threshold > 0)}
              onChange={(text) =>
                set(index, { threshold: parseAmount(text) }, "text")
              }
            />
            {remove(index)}
          </ListRow>,
          <ListRow key={`${key}-again`} label="Tell me again">
            <Select
              variant="row"
              aria-label="Tell me again"
              value={String(rule.stepPercent || 5)}
              options={againOptions(rule).map((o) => ({
                value: String(o.value),
                label: o.label,
              }))}
              onChange={(v) => set(index, { stepPercent: Number(v) }, "now")}
            />
          </ListRow>,
          <ListRow
            key={`${key}-reset`}
            label="Starts over"
            meta={resetLine(rule, { currency })}
          >
            <EditPill
              aria-label="Starts over, percent back past your line"
              value={pctText(rule.resetPercent || 0.5)}
              after="%"
              numeric
              width={40}
              onChange={(text) =>
                set(index, { resetPercent: parseAmount(text) }, "text")
              }
            />
          </ListRow>,
        );
        break;
      }
      case "move_pct":
        rows.push(
          <ListRow key={`${key}-line`} label="Moves by">
            <EditPill
              aria-label="Moves by, percent"
              value={pctText(rule.percent)}
              after="%"
              numeric
              width={40}
              invalid={
                flag &&
                !(
                  rule.percent != null &&
                  rule.percent > 0 &&
                  rule.percent <= 1000
                )
              }
              onChange={(text) =>
                set(index, { percent: parseAmount(text) }, "text")
              }
            />
            {remove(index)}
          </ListRow>,
          <ListRow key={`${key}-way`} label="Which way">
            <Select
              variant="row"
              aria-label="Which way"
              value={rule.direction || "any"}
              options={DIRECTIONS}
              onChange={(v) =>
                set(index, { direction: v as Rule["direction"] }, "now")
              }
            />
          </ListRow>,
        );
        break;
      case "words_appear":
      case "words_disappear":
      case "new_item": {
        const optional = rule.kind === "new_item";
        rows.push(
          <ListRow
            key={`${key}-line`}
            label={RULE_LABELS[rule.kind]}
            meta={
              optional
                ? "Only posts with these words, or leave it empty"
                : "Separate words with commas"
            }
          >
            <EditPill
              aria-label={
                optional ? "Only posts with these words" : "Words to look for"
              }
              value={(rule.words ?? []).join(", ")}
              placeholder={optional ? "Any post" : "Add to cart"}
              width={150}
              invalid={
                flag && !optional && !(rule.words ?? []).some((w) => w.trim())
              }
              onChange={(text) =>
                set(
                  index,
                  {
                    words: text
                      .split(",")
                      .map((w) => w.trim())
                      .filter(Boolean),
                  },
                  "text",
                )
              }
            />
            {remove(index)}
          </ListRow>,
        );
        break;
      }
      default:
        rows.push(
          <ListRow
            key={`${key}-line`}
            label={RULE_LABELS.any_change}
            meta="Any change to what it reads"
          >
            {remove(index)}
          </ListRow>,
        );
    }
  });

  if (rules.length < BOT_LIMITS.maxRulesPerWatch) {
    rows.push(
      <ListRow key={`${keyBase}-add`} label="Add rule" tone="add">
        <Select
          variant="row"
          aria-label="Add rule"
          value=""
          placeholder="Pick a kind"
          options={rulesFor(watch).map((kind) => ({
            value: kind,
            label: RULE_LABELS[kind],
          }))}
          onChange={(kind) =>
            onChange([...rules, newRule(kind as RuleKind, watch)], "now")
          }
        />
      </ListRow>,
    );
  }
  return rows;
}

/**
 * Tells me when: How smart (Rules only; AI judges and Research come later),
 * then each watch's rules as grouped rows with the values typed in place.
 * With two or more watches each watch's rules sit under its own sub-label.
 */
export function RulesGroup({
  watches,
  views,
  judgeMode,
  onRules,
  error,
}: {
  watches: WatchInput[];
  /** The saved watches by id, for their currency and title. */
  views?: Map<string, WatchView>;
  judgeMode?: string;
  onRules: (index: number, rules: Rule[], how: "text" | "now") => void;
  error?: ReactNode;
}) {
  const total = watches.reduce((n, w) => n + (w.rules?.length ?? 0), 0);
  const aside =
    watches.length === 0
      ? undefined
      : watches.length === 1
        ? `${total} of ${BOT_LIMITS.maxRulesPerWatch} rules`
        : `${total} rules`;
  const rows: ReactElement[] = [
    <ListRow key="smart" label="How smart" className="min-h-12">
      <SegmentedControl
        size="sm"
        aria-label="How smart"
        value={judgeMode || "rules"}
        onChange={() => {}}
        options={HOW_SMART.map((h) => ({
          value: h.id,
          label: h.label,
          disabled: h.later,
          tag: h.later ? "Later" : undefined,
        }))}
      />
    </ListRow>,
  ];
  if (watches.length === 0) {
    rows.push(
      <ListRow key="none" label="Rules" className="opacity-50">
        <span
          className={cn(
            rowValueClass,
            "cursor-default hover:bg-transparent hover:text-muted-foreground",
          )}
        >
          Add a watch first
        </span>
      </ListRow>,
    );
  }
  watches.forEach((w, index) => {
    const view = w.id ? views?.get(w.id) : undefined;
    if (watches.length > 1) {
      rows.push(
        <ListSubLabel key={`sub-${index}`}>
          {view ? watchTitle(view) : watchTitle(w)}
        </ListSubLabel>,
      );
    }
    rows.push(
      ...ruleRows({
        watch: w,
        view,
        keyBase: `w${index}`,
        flag: !!error,
        onChange: (rules, how) => onRules(index, rules, how),
      }),
    );
  });
  return (
    <section>
      <GroupLabel aside={aside}>Tells me when</GroupLabel>
      <ListGroup>{rows}</ListGroup>
      {error ? (
        <GroupHint className="text-destructive">{error}</GroupHint>
      ) : null}
      <GroupHint>
        Rules cost nothing and never call an AI. AI judging arrives in a later
        version.
      </GroupHint>
    </section>
  );
}
