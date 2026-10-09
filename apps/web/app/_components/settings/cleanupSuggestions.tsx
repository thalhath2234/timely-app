"use client";

import { useState } from "react";
import { ArrowLeftRight, Sparkles, X } from "lucide-react";
import type { CleanupMerge } from "@/app/utils/api/decisions";
import { useCleanupSuggestions, useDecisionFeedback, useMergeTaxonomy } from "@/app/utils/hooks/decisions";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";

const nouns = { label: "label", status: "status", option: "option" } as const;

function uses(n: number) {
  return `${n} use${n === 1 ? "" : "s"}`;
}

/** Labels, statuses or select options smart suggestions think mean the same
 * thing, with a merge that moves every task, project and saved view over to
 * the kept one. Nothing shows while suggestions are off or find no pair. */
export default function CleanupSuggestions({ workspaceId, kind }: { workspaceId: string; kind: CleanupMerge["kind"] }) {
  const { data } = useCleanupSuggestions(workspaceId);
  const merge = useMergeTaxonomy(workspaceId);
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [swapped, setSwapped] = useState<Set<string>>(new Set());
  if (!data?.available) return null;

  const keyOf = (m: CleanupMerge) => `${m.fieldId ?? ""}:${m.from.id}:${m.into.id}`;
  const merges = data.merges.filter((m) => m.kind === kind && !hidden.has(keyOf(m)));
  if (merges.length === 0) return null;

  return (
    <section className="mb-4 rounded-lg border border-border bg-muted/20 p-2" data-testid="cleanup-suggestions" aria-label="Merge suggestions">
      <h3 className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="size-3.5" /> Look like the same {nouns[kind]}
      </h3>
      <ul className="flex flex-col">
        {merges.map((suggested) => {
          const key = keyOf(suggested);
          const m = swapped.has(key) ? { ...suggested, from: suggested.into, into: suggested.from } : suggested;
          return (
            <li key={key} className="flex flex-wrap items-center gap-2 rounded-md px-1 py-1 text-sm text-muted-foreground">
              <span className="min-w-0 flex-1">
                Merge <strong className="font-medium text-foreground">{m.from.name}</strong> ({uses(m.from.uses)}) into{" "}
                <strong className="font-medium text-foreground">{m.into.name}</strong> ({uses(m.into.uses)})
                {m.fieldName ? <> in {m.fieldName}</> : null}
              </span>
              <button
                type="button"
                title="Keep the other one"
                aria-label="Swap which one is kept"
                onClick={() =>
                  setSwapped((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeftRight className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  requestConfirm({
                    title: `Merge “${m.from.name}” into “${m.into.name}”?`,
                    description: `Everything using “${m.from.name}” switches to “${m.into.name}”, including saved views, and “${m.from.name}” is deleted. This cannot be undone.`,
                    confirmLabel: "Merge",
                    pendingLabel: "Merging…",
                    onConfirm: async () => {
                      try {
                        const result = await merge.mutateAsync(m);
                        if (data.logId) feedback.mutate({ logId: data.logId, accepted: true });
                        setHidden((prev) => new Set(prev).add(key));
                        const moved = result.tasks + result.projects;
                        useToastStore.getState().show(`Merged into “${m.into.name}”${moved ? `, ${moved} item${moved === 1 ? "" : "s"} updated` : ""}`);
                      } catch (error) {
                        useToastStore.getState().show(error instanceof Error ? error.message : "Could not merge");
                      }
                    },
                  })
                }
                className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                Merge
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setHidden((prev) => new Set(prev).add(key))}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
