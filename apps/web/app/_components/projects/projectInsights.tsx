"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, X } from "lucide-react";
import type { Project } from "@/app/_types/types";
import type { ProjectInsights as Insights } from "@/app/utils/api/decisions";
import { useDecisionFeedback, useProjectInsights } from "@/app/utils/hooks/decisions";
import { useCreateTask, useUpdateTask } from "@/app/utils/hooks/tasks";
import { openTasksEntity } from "@/app/utils/entityDetail";
import { showUndoToast } from "@/app/_store/toastStore";
import { useQueryClient } from "@tanstack/react-query";

const health: Record<NonNullable<Insights["health"]>, { label: string; className: string }> = {
  progressing: { label: "Progressing", className: "bg-success/10 text-success" },
  stalled: { label: "Stalled", className: "bg-warning/10 text-warning" },
  blocked: { label: "Blocked", className: "bg-destructive/10 text-destructive" },
};

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function factLine(f: Insights["facts"]) {
  const parts = [`${f.open} open`, `${f.doneRecent} done in the last two weeks`];
  if (f.overdue) parts.push(`${f.overdue} overdue`);
  if (f.blocked) parts.push(`${f.blocked} waiting on other tasks`);
  if (f.idleDays >= 7) parts.push(`no activity for ${f.idleDays} days`);
  if (f.daysLeft !== undefined) {
    parts.push(f.daysLeft < 0 ? `deadline passed ${days(-f.daysLeft)} ago` : f.daysLeft === 0 ? "due today" : `${days(f.daysLeft)} to the deadline`);
  }
  return parts.join(" · ");
}

/** What smart suggestions read in a project: how it is going, a brief with no
 * outcome or next step, brief items no task covers, tasks that look filed in
 * the wrong project, and projects that overlap. Counts are worked out on the
 * server; nothing shows while suggestions are off. */
export default function ProjectInsights({ project }: { project: Project }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useProjectInsights(project.id, `${project.description?.length ?? 0}:${project.updatedAt ?? ""}`);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  if (!data?.available || project.completedAt) return null;

  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));
  const accept = () => {
    if (data.logId && !sent) {
      setSent(true);
      feedback.mutate({ logId: data.logId, accepted: true });
    }
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["project-insights", project.id] });

  const notes: { key: string; text: string }[] = [];
  if (data.noBrief) notes.push({ key: "brief", text: "No brief yet. Say what this project is for and what done looks like." });
  else if (data.noOutcome) notes.push({ key: "outcome", text: "The brief does not say what result finishes the project." });
  if (data.noNextAction)
    notes.push({
      key: "next",
      text: data.facts.open === 0 ? "No open tasks. Add the next step." : "None of the open tasks reads like a clear next step.",
    });
  const uncovered = (data.uncovered ?? []).filter((r) => !hidden.has(`req:${r}`));
  const misfiled = (data.misfiled ?? []).filter((m) => !hidden.has(`move:${m.taskId}`));
  const overlaps = (data.overlaps ?? []).filter((p) => !hidden.has(`overlap:${p.id}`));
  const shownNotes = notes.filter((n) => !hidden.has(n.key));
  const tag = data.health ? health[data.health] : undefined;

  const dismiss = (key: string) => (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={() => hide(key)}
      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  );
  const button = "shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent";

  return (
    <section className="rounded-xl border border-border bg-card p-3" data-testid="project-insights" aria-label="Project insights">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3.5" /> Insights
        </h3>
        {tag && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tag.className}`}>{tag.label}</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{factLine(data.facts)}</p>

      {(shownNotes.length > 0 || uncovered.length > 0 || misfiled.length > 0 || overlaps.length > 0) && (
        <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted-foreground">
          {shownNotes.map((note) => (
            <li key={note.key} className="flex items-center gap-2 rounded-md px-1 py-1">
              <span className="min-w-0 flex-1">{note.text}</span>
              {dismiss(note.key)}
            </li>
          ))}
          {uncovered.map((req) => (
            <li key={req} className="flex items-center gap-2 rounded-md px-1 py-1">
              <span className="min-w-0 flex-1">
                No task covers <strong className="font-medium text-foreground">{req}</strong> from the brief.
              </span>
              <button
                type="button"
                className={`${button} inline-flex items-center gap-1`}
                onClick={() => {
                  createTask.mutate(
                    { name: req, kind: "task", duration: 30, workspaceId: project.workspaceId ?? undefined, projectId: project.id },
                    { onSuccess: refresh },
                  );
                  accept();
                  hide(`req:${req}`);
                }}
              >
                <Plus className="size-3" /> Add task
              </button>
              {dismiss(`req:${req}`)}
            </li>
          ))}
          {misfiled.map((m) => (
            <li key={m.taskId} className="flex items-center gap-2 rounded-md px-1 py-1">
              <span className="min-w-0 flex-1">
                <button
                  type="button"
                  className="font-medium text-foreground hover:underline"
                  onClick={() => openTasksEntity({ kind: "task", id: m.taskId }, { navigate: (href) => router.push(href, { scroll: false }) })}
                >
                  {m.name}
                </button>{" "}
                {m.moveToTitle ? (
                  <>
                    looks like it belongs in <strong className="font-medium text-foreground">{m.moveToTitle}</strong>.
                  </>
                ) : (
                  "may not belong in this project."
                )}
              </span>
              {m.moveTo && (
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    updateTask.mutate({ id: m.taskId, projectId: m.moveTo, stageId: "" }, { onSuccess: refresh });
                    accept();
                    hide(`move:${m.taskId}`);
                    showUndoToast(`Moved “${m.name}” to ${m.moveToTitle}`, () =>
                      updateTask.mutate({ id: m.taskId, projectId: project.id, stageId: m.stageId ?? "" }, { onSuccess: refresh }),
                    );
                  }}
                >
                  Move
                </button>
              )}
              {dismiss(`move:${m.taskId}`)}
            </li>
          ))}
          {overlaps.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-md px-1 py-1">
              <span className="min-w-0 flex-1">
                Overlaps with{" "}
                <button type="button" className="font-medium text-foreground hover:underline" onClick={() => router.push(`/projects/${encodeURIComponent(p.id)}`)}>
                  {p.title}
                </button>
                .
              </span>
              {dismiss(`overlap:${p.id}`)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
