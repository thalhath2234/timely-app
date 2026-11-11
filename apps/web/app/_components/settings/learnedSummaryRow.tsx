"use client";
import Link from "next/link";
import { ChevronRight, Lightbulb } from "lucide-react";
import { LEARNED_TITLE, learnedSummary } from "@timely/contract/agentLearning";
import { useLearnedSkills, useLearningSettings, useStagedLearning } from "@/app/utils/hooks/learning";

/**
 * Settings → Agent: the "What Timely learned" row of option 1 ("14 skills ·
 * About you · 1 waiting"), opening the tab with the lists. The skill count
 * asks the agent, so it is read only while chats run on the New engine.
 */
export default function LearnedSummaryRow({ agent }: { agent: boolean }) {
  const settings = useLearningSettings();
  const staged = useStagedLearning();
  const skills = useLearnedSkills(agent);
  const waiting = (staged.data ?? []).filter((ev) => ev.pendingId).length;
  const own = skills.data?.filter((s) => s.source === "learned" || s.source === "edited").length;
  const summary =
    settings.data && !settings.data.learning
      ? "Learning is off"
      : own !== undefined
        ? learnedSummary(own, waiting)
        : waiting > 0
          ? `${waiting} waiting for you`
          : "Skills, About you and Notes";
  return (
    <Link
      href="/settings?tab=learned"
      data-testid="learned-summary"
      className="flex min-h-14 items-center gap-2.5 rounded-[12px] border border-border bg-card px-3.5 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
        <Lightbulb aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-foreground">{LEARNED_TITLE}</span>
        <span className="truncate text-xs text-muted-foreground">{summary}</span>
      </span>
      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}
