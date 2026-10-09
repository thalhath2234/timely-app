"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import type { CustomField, CustomFieldValueInput, Status } from "@/app/_types/types";
import { useDecisionFeedback, useTaskHints } from "@/app/utils/hooks/decisions";

type Stage = { id: string; name: string };

type Props = {
  taskId: string;
  /** Changes when the words or state the hints read change, to ask again. */
  version: string;
  statusId?: string | null;
  stageId?: string | null;
  blockedById?: string | null;
  statusOptions: Status[];
  stageOptions: Stage[];
  customFields: CustomField[];
  /** Fields that already hold a value; their hints are never shown. */
  filledFieldIds: Set<string>;
  onStatus: (statusId: string) => void;
  onStage: (stageId: string) => void;
  onField: (field: CustomField, next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">) => void;
  onBlocker: (taskId: string) => void;
};

type Row = { key: string; text: React.ReactNode; action?: { label: string; run: () => void } };

/** Hints a task's own words suggest (smart suggestions): a status, stage,
 * custom field values or blocker to apply, and notes on a vague outcome or a
 * checklist gap. Nothing shows while suggestions are off or unsure. */
export default function TaskHints(props: Props) {
  const { data } = useTaskHints(`${props.taskId}`, true, props.version);
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sentFor, setSentFor] = useState<string>();
  if (!data?.available) return null;

  const accept = () => {
    if (data.logId && sentFor !== data.logId) {
      setSentFor(data.logId);
      feedback.mutate({ logId: data.logId, accepted: true });
    }
  };
  const apply = (key: string, run: () => void) => () => {
    run();
    accept();
    setHidden((prev) => new Set(prev).add(key));
  };
  const strong = (text: string) => <strong className="font-medium text-foreground">{text}</strong>;

  const rows: Row[] = [];
  const status = props.statusOptions.find((s) => s.id === data.statusId);
  if (status && status.id !== props.statusId) {
    rows.push({ key: "status", text: <>The description reads like {strong(status.name)}.</>, action: { label: "Set status", run: () => props.onStatus(status.id) } });
  }
  const stage = props.stageOptions.find((s) => s.id === data.stageId);
  if (stage && !props.stageId) {
    rows.push({ key: "stage", text: <>Looks like part of the {strong(stage.name)} stage.</>, action: { label: "Set stage", run: () => props.onStage(stage.id) } });
  }
  for (const hint of data.fields ?? []) {
    const field = props.customFields.find((f) => f.id === hint.fieldId);
    if (!field || props.filledFieldIds.has(field.id)) continue;
    const options = field.options?.options ?? [];
    let value = "";
    let next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">;
    if (field.type === "boolean") {
      value = hint.value === "true" ? "Yes" : "No";
      next = { stringValue: hint.value ?? "false" };
    } else {
      const picked = options.filter((o) => hint.optionIds?.includes(o.id));
      if (picked.length === 0) continue;
      value = picked.map((o) => o.value).join(", ");
      next = { optionsValue: picked.map((o) => ({ id: o.id })) };
    }
    rows.push({
      key: `field:${field.id}`,
      text: <>{field.name}: {strong(value)}, from the description.</>,
      action: { label: "Fill in", run: () => props.onField(field, next) },
    });
  }
  if (data.blockedBy && !props.blockedById) {
    const blocker = data.blockedBy;
    rows.push({ key: "blocker", text: <>Seems to wait on {strong(blocker.name)}.</>, action: { label: "Set as blocker", run: () => props.onBlocker(blocker.id) } });
  }
  if (data.vagueOutcome) rows.push({ key: "outcome", text: <>It is not clear what counts as done. A “done when” line would help.</> });
  if (data.checklistGap) rows.push({ key: "gap", text: <>The description asks for something the checklist does not cover.</> });
  if (data.notDone) rows.push({ key: "left", text: <>Marked complete, but the description or comments say something is left.</> });
  if (data.openChecklist) {
    rows.push({
      key: "open",
      text: <>Marked complete with {data.openChecklist} unchecked checklist item{data.openChecklist === 1 ? "" : "s"}.</>,
    });
  }

  const shown = rows.filter((row) => !hidden.has(row.key));
  if (shown.length === 0) return null;

  return (
    <section className="mb-5 rounded-lg border border-border bg-muted/20 p-2" data-testid="task-hints" aria-label="Suggestions">
      <h3 className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="size-3.5" /> Suggestions
      </h3>
      <ul className="flex flex-col">
        {shown.map((row) => (
          <li key={row.key} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">{row.text}</span>
            {row.action && (
              <button
                type="button"
                onClick={apply(row.key, row.action.run)}
                className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                {row.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setHidden((prev) => new Set(prev).add(row.key))}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
