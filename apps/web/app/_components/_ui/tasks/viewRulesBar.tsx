"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ListFilter, Plus, Sparkles, X } from "lucide-react";
import { newCondition, replaceRule } from "@timely/contract/ruleBuilder";
import { isRuleGroup, normalizeRules } from "@timely/contract/taskQuery";
import {
  aiDraftPatch,
  describeView,
  readingPatch,
  readViewQuery,
  type ViewChip,
  type ViewVocabulary,
} from "@timely/contract/viewLanguage";
import type { TaskRuleField, TaskViewCondition } from "@timely/contract/config";
import type { CustomField, TaskViewConfig } from "@/app/_types/types";
import Button from "@/app/_components/_ui/button";
import { popoverSurface } from "@/app/_components/_ui/field";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import { PopoverView } from "@/app/_components/_ui/motion";
import { RuleEditor, RuleFieldMenu } from "@/app/_components/_ui/tasks/ruleEditor";
import { readViewWithAi } from "@/app/utils/api/viewQuery";
import { cn } from "@/app/utils/cn";

/** Everything but the rules already has a control above: options bar, Sort (second sort and limit), Group, layout. */
function shownElsewhere(chip: ViewChip): boolean {
  return !chip.key.startsWith("rule:");
}

/**
 * One pill per part of a view [natural-language views]. With `onRemove`,
 * each pill has an x that takes that part off. `editor` turns a pill into a
 * button that opens its panel (the rule builder's filter editor).
 */
export function ViewChips({
  chips,
  onRemove,
  className,
  editor,
  openKey,
  onOpen,
  children,
}: {
  chips: ViewChip[];
  onRemove?: (chip: ViewChip) => void;
  className?: string;
  editor?: (chip: ViewChip) => ReactNode | null;
  openKey?: string | null;
  onOpen?: (key: string | null) => void;
  /** Drawn after the last pill (the Add filter button). */
  children?: ReactNode;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="What this view shows">
      {chips.map((chip) => {
        const panel = openKey === chip.key && editor ? editor(chip) : null;
        const editable = Boolean(editor && onOpen && chip.key.startsWith("rule:"));
        return (
          <li
            key={chip.key}
            data-rule-popover={editable || undefined}
            className={cn(
              "relative inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-muted text-xs font-medium text-foreground",
              onRemove ? "pl-2.5 pr-1" : "px-2.5",
              openKey === chip.key && "ring-2 ring-ring/30",
            )}
          >
            {editable ? (
              <button
                type="button"
                aria-expanded={openKey === chip.key}
                aria-haspopup="dialog"
                title="Edit this filter"
                onClick={() => onOpen?.(openKey === chip.key ? null : chip.key)}
                className="truncate rounded-full outline-none hover:underline focus-visible:underline"
              >
                {chip.label}
              </button>
            ) : (
              <span className="truncate">{chip.label}</span>
            )}
            {onRemove ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(chip);
                }}
                aria-label={`Remove ${chip.label}`}
                className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X size={11} aria-hidden="true" />
              </button>
            ) : null}
            {panel ? (
              <PopoverView>
                <div role="dialog" aria-label={`Edit ${chip.label}`} className={cn(popoverSurface, "absolute top-full left-0 z-40 mt-1.5")}>
                  {panel}
                </div>
              </PopoverView>
            ) : null}
          </li>
        );
      })}
      {children}
    </ul>
  );
}

const ADD_KEY = "add";

/**
 * The rules row under the options bar [rule builder]: a box to describe the
 * view in words, a pill per filter (click to edit, x to remove), Add filter
 * and, with two or more filters, whether all or any must match. For a
 * Preview from search it also carries Save as view and Close and shows every
 * part of the view, since nothing is saved yet.
 */
export default function ViewRulesBar({
  view,
  vocab,
  customFields,
  today,
  aiReady,
  onPatch,
  preview,
  scope,
}: {
  view: TaskViewConfig | undefined;
  vocab: ViewVocabulary;
  customFields: readonly CustomField[];
  today: string;
  aiReady: boolean;
  onPatch: (patch: Partial<TaskViewConfig>) => void;
  preview?: { onSave: () => void; onClose: () => void; full: boolean };
  scope?: "global" | "project";
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [words, setWords] = useState({ viewId: "", text: "" });
  const [ai, setAi] = useState<{ text: string; busy?: boolean; error?: string; done?: boolean } | null>(null);
  const [leftover, setLeftover] = useState<{ text: string; words: string[] } | null>(null);

  useEffect(() => {
    if (!openKey) return;
    const inside = (event: Event) =>
      event.composedPath().some(
        (node) =>
          node instanceof Element && (node.matches("[data-rule-popover]") || node.matches("[data-select-portal='true']")),
      );
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!inside(event)) setOpenKey(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenKey(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKey]);

  if (!view) return null;
  const rules = normalizeRules(view.rules);
  const all = describeView(view, vocab);
  const chips = preview ? all.filter((chip) => chip.key !== "match:any") : all.filter((chip) => !shownElsewhere(chip));
  const text = words.viewId === view.id ? words.text : "";
  const setText = (next: string) => setWords({ viewId: view.id, text: next });
  const pendingWords = leftover && leftover.text === text.trim() ? leftover.words : [];

  const setRule = (index: number, rule: TaskViewCondition | null) => {
    onPatch({ rules: replaceRule(rules, index, rule) });
    if (rule === null) setOpenKey(null);
  };

  const addRule = (field: TaskRuleField) => {
    onPatch({ rules: [...rules, newCondition(field, customFields)] });
    setOpenKey(`rule:${rules.length}`);
  };

  const describe = (event: React.FormEvent) => {
    event.preventDefault();
    const query = text.trim();
    if (!query) return;
    const reading = readViewQuery(query, vocab, { today });
    if (reading.understood === 0 && reading.leftover.length === 0) return;
    onPatch({ ...readingPatch(reading), prompt: query.slice(0, 300) });
    setLeftover({ text: query, words: reading.leftover });
    setAi(null);
  };

  const askAi = () => {
    const query = text.trim();
    setAi({ text: query, busy: true });
    readViewWithAi({ query, today, client: "web" })
      .then((result) => {
        onPatch({ ...aiDraftPatch(result.view, vocab), prompt: query.slice(0, 300) });
        setAi({ text: query, done: true });
        setLeftover(null);
      })
      .catch((error: Error) => setAi({ text: query, error: error.message }));
  };
  const aiState = ai?.text === text.trim() ? ai : null;

  const editor = (chip: ViewChip) => {
    const index = Number(chip.key.slice(5));
    const rule = rules[index];
    if (!rule) return null;
    if (isRuleGroup(rule)) {
      return (
        <div className="w-72 space-y-2 p-3 text-xs">
          <p className="text-muted-foreground">
            This filter has {rule.rules.length} parts that {rule.match === "any" ? "can each match" : "must all match"}. Remove it and add
            the parts you want, or describe the view again.
          </p>
          <div className="flex justify-end">
            <Button size="sm" variant="destructive-ghost" onClick={() => setRule(index, null)}>
              Remove filter
            </Button>
          </div>
        </div>
      );
    }
    return (
      <RuleEditor
        rule={rule}
        vocab={vocab}
        customFields={customFields}
        scope={scope}
        onChange={(next) => setRule(index, next)}
        onRemove={() => setRule(index, null)}
        onDone={() => setOpenKey(null)}
      />
    );
  };

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-6 py-2", preview && "bg-primary/5")}
      data-testid={preview ? "view-preview-bar" : "view-rules-bar"}
    >
      {preview ? (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Preview</span>
      ) : null}
      <form onSubmit={describe} className="flex w-full max-w-sm min-w-56 items-center gap-1.5 sm:w-auto sm:flex-1">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-card px-2 shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <ListFilter className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Describe what to show: urgent bugs due this week"
            aria-label="Describe what this view shows"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {aiReady && text.trim() && (pendingWords.length > 0 || aiState) && !aiState?.done ? (
          <Button size="sm" variant="ghost" type="button" onClick={askAi} disabled={aiState?.busy} title="Your AI provider reads the words the plain reading left as text">
            <Sparkles aria-hidden="true" />
            {aiState?.busy ? "Reading…" : "Read with AI"}
          </Button>
        ) : null}
      </form>
      {aiState?.error ? <span className="text-xs text-destructive">{aiState.error}</span> : null}
      <ViewChips
        chips={chips}
        onRemove={(chip) => {
          setOpenKey(null);
          onPatch(chip.remove);
        }}
        className="min-w-0 flex-1"
        editor={editor}
        openKey={openKey}
        onOpen={setOpenKey}
      >
        <li className="relative" data-rule-popover>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={openKey === ADD_KEY}
            aria-haspopup="dialog"
            onClick={() => setOpenKey(openKey === ADD_KEY ? null : ADD_KEY)}
          >
            <Plus aria-hidden="true" />
            Add filter
          </Button>
          {openKey === ADD_KEY ? (
            <PopoverView>
              <div role="dialog" aria-label="Add a filter" className={cn(popoverSurface, "absolute top-full left-0 z-40 mt-1")}>
                <RuleFieldMenu customFields={customFields} scope={scope} onPick={addRule} />
              </div>
            </PopoverView>
          ) : null}
        </li>
        {rules.length > 1 ? (
          <li className="inline-flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Match</span>
            <SegmentedControl
              size="sm"
              aria-label="Which filters must match"
              value={view.ruleMatch === "any" ? "any" : "all"}
              onChange={(next) => onPatch({ ruleMatch: next === "any" ? "any" : undefined })}
              options={[
                { value: "all", label: "All", title: "A task must pass every filter" },
                { value: "any", label: "Any", title: "A task passing one filter is enough" },
              ]}
            />
          </li>
        ) : null}
      </ViewChips>
      {preview ? (
        <div className="ml-auto flex items-center gap-1.5">
          {preview.full ? <span className="text-xs text-muted-foreground">20 views saved; delete one to save this</span> : null}
          <Button size="sm" variant="ghost" onClick={preview.onClose}>
            Close
          </Button>
          <Button size="sm" variant="primary" onClick={preview.onSave} disabled={preview.full}>
            Save as view
          </Button>
        </div>
      ) : null}
    </div>
  );
}
