"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, X } from "lucide-react";
import { applyStarterLabels, type StarterLabel } from "@/app/utils/api/decisions";
import { useDecisionFeedback, useStarterLabels } from "@/app/utils/hooks/decisions";
import { useToastStore } from "@/app/_store/toastStore";

/** Labels smart suggestions think this workspace is missing, picked from a
 * starter catalog by what the person uses Timely for and the work already in
 * it. Nothing shows while suggestions are off or find nothing to add. */
export default function StarterLabels({ workspaceId }: { workspaceId: string }) {
  const { data } = useStarterLabels(workspaceId);
  const feedback = useDecisionFeedback();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!data?.available || hidden || data.labels.length === 0) return null;

  const chosen = picked ?? new Set(data.labels.map((l) => l.name));
  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPicked(next);
  };

  const add = async () => {
    const labels: StarterLabel[] = data.labels.filter((l) => chosen.has(l.name));
    if (labels.length === 0) return;
    setSaving(true);
    try {
      const result = await applyStarterLabels(workspaceId, labels);
      if (data.logId) feedback.mutate({ logId: data.logId, accepted: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["config"] }),
        queryClient.invalidateQueries({ queryKey: ["starter-labels"] }),
      ]);
      const made = result.created.length;
      const skipped = result.skipped.length;
      useToastStore
        .getState()
        .show(
          `Added ${made} label${made === 1 ? "" : "s"}${skipped ? `; ${skipped} already used elsewhere (${result.skipped.join(", ")})` : ""}`,
        );
      setHidden(true);
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not add labels");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-4 rounded-lg border border-border bg-muted/20 p-2" data-testid="starter-labels" aria-label="Suggested labels">
      <div className="mb-1 flex items-center gap-1.5 px-1">
        <h3 className="flex flex-1 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3.5" /> Labels that may help here
        </h3>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            if (data.logId) feedback.mutate({ logId: data.logId, accepted: false });
            setHidden(true);
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-1 py-1">
        {data.labels.map((l) => {
          const on = chosen.has(l.name);
          return (
            <button
              key={l.name}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(l.name)}
              className={
                "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors " +
                (on ? "border-border bg-background text-foreground" : "border-dashed border-border text-muted-foreground opacity-60")
              }
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} />
              {l.name}
            </button>
          );
        })}
        <button
          type="button"
          disabled={saving || chosen.size === 0}
          onClick={add}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Plus className="size-3" /> {saving ? "Adding…" : `Add ${chosen.size}`}
        </button>
      </div>
    </section>
  );
}
