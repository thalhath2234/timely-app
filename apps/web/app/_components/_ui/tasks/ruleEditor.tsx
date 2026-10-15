"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import {
  choiceSelected,
  DATE_PRESETS,
  isFixedDay,
  newCondition,
  numberUnit,
  opTakesValue,
  ruleChoices,
  ruleFieldChoices,
  ruleOpChoices,
  toggleChoice,
  withOp,
  type RuleFieldChoice,
} from "@timely/contract/ruleBuilder";
import { PRIORITY_VALUES, ruleFieldInfo } from "@timely/contract/taskQuery";
import { dateWords, type ViewVocabulary } from "@timely/contract/viewLanguage";
import type { TaskRuleField, TaskRuleOp, TaskViewCondition } from "@timely/contract/config";
import type { CustomField } from "@/app/_types/types";
import Button from "@/app/_components/_ui/button";
import DatePicker from "@/app/_components/_ui/datePicker";
import { Input, menuItemClass } from "@/app/_components/_ui/field";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import Select from "@/app/_components/_ui/select";
import { cn } from "@/app/utils/cn";

/**
 * The fields a filter can read, searchable, under their section headings.
 * Picking one adds a rule that already does something [rule builder].
 */
export function RuleFieldMenu({
  customFields,
  scope,
  onPick,
}: {
  customFields: readonly CustomField[];
  scope?: "global" | "project";
  onPick: (field: TaskRuleField) => void;
}) {
  const [query, setQuery] = useState("");
  const fields = useMemo(() => ruleFieldChoices(customFields, { scope }), [customFields, scope]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? fields.filter((item) => `${item.label} ${item.section}`.toLowerCase().includes(needle)) : fields;
  const sections = shown.reduce<[string, RuleFieldChoice[]][]>((out, item) => {
    const last = out[out.length - 1];
    if (last && last[0] === item.section) last[1].push(item);
    else out.push([item.section, [item]]);
    return out;
  }, []);

  return (
    <div className="flex max-h-[min(420px,calc(100vh-200px))] w-64 flex-col">
      <label className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && shown[0]) {
              event.preventDefault();
              onPick(shown[0].field);
            }
          }}
          placeholder="Filter by…"
          aria-label="Find a field to filter by"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div className="overflow-y-auto p-1">
        {sections.map(([section, items]) => (
          <div key={section} className="pb-1">
            <p className="px-2 pt-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">{section}</p>
            {items.map((item) => (
              <button
                key={item.field}
                type="button"
                onClick={() => onPick(item.field)}
                className={cn(menuItemClass, "hover:bg-accent hover:text-accent-foreground")}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
        {sections.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">No field by that name</p> : null}
      </div>
    </div>
  );
}

/** A date rule's value: a date word that moves with the calendar, or a day from Timely's picker. */
function DateValue({ value, onChange, label }: { value: unknown; onChange: (value: string) => void; label: string }) {
  const fixed = isFixedDay(value);
  const known = DATE_PRESETS.some((preset) => preset.value === value);
  const options = [
    ...DATE_PRESETS,
    ...(fixed ? [{ value: String(value), label: dateWords(value) }] : []),
    ...(!fixed && !known && typeof value === "string" && value ? [{ value, label: dateWords(value) }] : []),
  ];
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <Select size="sm" value={typeof value === "string" ? value : ""} onChange={onChange} options={options} aria-label={label} />
      </div>
      <DatePicker
        mode="date"
        size="sm"
        iconOnly
        clearable={false}
        value={fixed ? String(value) : ""}
        onChange={(day) => day && onChange(day.slice(0, 10))}
        aria-label={`${label}: pick a day`}
      />
    </div>
  );
}

/** Text being typed over a saved value; a new saved value replaces it. */
function useDraft(saved: string) {
  const [draft, setDraft] = useState({ from: saved, text: saved });
  const text = draft.from === saved ? draft.text : saved;
  return [text, (next: string) => setDraft({ from: saved, text: next })] as const;
}

/** A number box that saves when it loses focus or on Enter, so typing "120" doesn't save 1 and 12. */
function NumberValue({
  value,
  onChange,
  unit,
  label,
}: {
  value: unknown;
  onChange: (value: number) => void;
  unit: string;
  label: string;
}) {
  const shown = typeof value === "number" || typeof value === "string" ? String(value) : "";
  const [draft, setDraft] = useDraft(shown);
  const commit = () => {
    const number = Number(draft);
    if (draft.trim() && Number.isFinite(number) && String(number) !== shown) onChange(number);
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Input
        size="sm"
        type="number"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
        aria-label={label}
      />
      {unit ? <span className="shrink-0 text-xs text-muted-foreground">{unit}</span> : null}
    </div>
  );
}

function TextValue({ value, onChange, label }: { value: unknown; onChange: (value: string) => void; label: string }) {
  const shown = typeof value === "string" ? value : "";
  const [draft, setDraft] = useDraft(shown);
  const commit = () => draft !== shown && onChange(draft);
  return (
    <Input
      size="sm"
      autoFocus={!shown}
      value={draft}
      placeholder="Words to look for"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
      aria-label={label}
    />
  );
}

/**
 * One filter's field, condition and value [rule builder]. Dates use Timely's
 * own picker or a date word ("This week") so a saved view keeps up with the
 * calendar; choices are a checklist; text and numbers save on Enter or blur.
 */
export function RuleEditor({
  rule,
  vocab,
  customFields,
  scope,
  onChange,
  onRemove,
  onDone,
}: {
  rule: TaskViewCondition;
  vocab: ViewVocabulary;
  customFields: readonly CustomField[];
  scope?: "global" | "project";
  onChange: (rule: TaskViewCondition) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const info = ruleFieldInfo(rule.field, customFields);
  const kind = info?.kind ?? "text";
  const fields = useMemo(() => ruleFieldChoices(customFields, { scope }), [customFields, scope]);
  const ops = ruleOpChoices(rule.field, customFields);
  const choices = kind === "choice" ? ruleChoices(rule.field, vocab) : [];
  const [choiceQuery, setChoiceQuery] = useState("");
  const fieldName = info?.label ?? "Field";
  const needle = choiceQuery.trim().toLowerCase();
  const shownChoices = needle ? choices.filter((choice) => choice.label.toLowerCase().includes(needle)) : choices;

  const value = (() => {
    if (!opTakesValue(rule.op)) return null;
    if (kind === "flag") {
      return (
        <SegmentedControl
          size="sm"
          fill
          aria-label={fieldName}
          value={rule.value === false ? "no" : "yes"}
          onChange={(next) => onChange({ ...rule, value: next === "yes" })}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
        />
      );
    }
    if (kind === "date") {
      return (
        <div className="space-y-1.5">
          <DateValue
            value={rule.value}
            label={rule.op === "between" ? `${fieldName} from` : fieldName}
            onChange={(next) => onChange({ ...rule, value: next })}
          />
          {rule.op === "between" ? (
            <DateValue value={rule.to} label={`${fieldName} to`} onChange={(next) => onChange({ ...rule, to: next })} />
          ) : null}
        </div>
      );
    }
    if (kind === "number") {
      const unit = numberUnit(rule.field);
      return (
        <div className="flex items-center gap-1.5">
          <NumberValue value={rule.value} unit={unit} label={fieldName} onChange={(next) => onChange({ ...rule, value: next })} />
          {rule.op === "between" ? (
            <>
              <span className="text-xs text-muted-foreground">and</span>
              <NumberValue value={rule.to} unit={unit} label={`${fieldName} up to`} onChange={(next) => onChange({ ...rule, to: next })} />
            </>
          ) : null}
        </div>
      );
    }
    if (kind === "choice" && rule.field === "priority" && (rule.op === "gte" || rule.op === "lte")) {
      return (
        <SegmentedControl
          size="sm"
          fill
          aria-label="Priority"
          value={typeof rule.value === "string" ? rule.value : "High"}
          onChange={(next) => onChange({ ...rule, value: next })}
          options={PRIORITY_VALUES.map((level) => ({ value: level, label: level }))}
        />
      );
    }
    if (kind === "choice") {
      return (
        <div className="rounded-md border border-border">
          {choices.length > 8 ? (
            <label className="flex items-center gap-2 border-b border-border px-2 py-1.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                value={choiceQuery}
                onChange={(event) => setChoiceQuery(event.target.value)}
                placeholder={`Find a ${fieldName.toLowerCase().replace(/s$/, "")}`}
                aria-label={`Find a ${fieldName.toLowerCase()}`}
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </label>
          ) : null}
          <div className="max-h-52 overflow-y-auto p-1" role="group" aria-label={fieldName}>
            {shownChoices.map((choice) => {
              const on = choiceSelected(rule, choice);
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => onChange(toggleChoice(rule, choice))}
                  className={cn(menuItemClass, "text-xs hover:bg-accent hover:text-accent-foreground")}
                >
                  <span
                    className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                    )}
                  >
                    {on ? <Check className="size-2.5" strokeWidth={3} aria-hidden="true" /> : null}
                  </span>
                  {choice.color ? <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: choice.color }} /> : null}
                  <span className="truncate">{choice.label}</span>
                </button>
              );
            })}
            {shownChoices.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {choices.length ? "Nothing by that name" : `No ${fieldName.toLowerCase()} yet`}
              </p>
            ) : null}
          </div>
        </div>
      );
    }
    return <TextValue value={rule.value} label={fieldName} onChange={(next) => onChange({ ...rule, value: next })} />;
  })();

  return (
    <div className="w-80 space-y-2 p-3" data-testid="rule-editor">
      <div className="grid grid-cols-2 gap-1.5">
        <Select
          size="sm"
          searchable
          value={rule.field}
          aria-label="Field"
          onChange={(next) => {
            if (next === rule.field) return;
            onChange(newCondition(next as TaskRuleField, customFields));
          }}
          options={fields.map((item) => ({ value: item.field, label: item.label, group: item.section }))}
        />
        <Select
          size="sm"
          value={rule.op}
          aria-label="Condition"
          onChange={(next) => onChange(withOp(rule, next as TaskRuleOp, customFields))}
          options={ops}
        />
      </div>
      {value}
      <div className="flex items-center justify-between border-t border-border pt-2">
        <Button size="sm" variant="destructive-ghost" onClick={onRemove}>
          Remove filter
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
