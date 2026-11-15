"use client";

import { Sparkles } from "lucide-react";
import type { BotView } from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { useToastStore } from "@/app/_store/toastStore";
import { useConvertBot, useConvertPreview } from "@/app/utils/hooks/bots";
import { scheduleWords } from "./agentBot";
import type { BotSchedule } from "@/app/_types/types";

/**
 * A rules Bot offers to become an agent: the text it would run on, shown
 * first. Approving converts this one Bot only; there is no bulk control
 * (Q-B4). A brief is not offered it, and a failed preview says nothing.
 */
export function SwitchToAgentCard({ bot }: { bot: BotView }) {
  const preview = useConvertPreview(bot.id, bot.kind !== "brief");
  const convert = useConvertBot();
  if (bot.kind === "brief" || !preview.data) return null;
  const plan = preview.data;
  return (
    <section
      className="mb-5 overflow-hidden rounded-[12px] border border-primary/30 bg-primary/5"
      data-testid="switch-to-agent"
    >
      <div className="flex items-start gap-2.5 px-3.5 pb-2.5 pt-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-primary/12 text-primary"
        >
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Switch to agent
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            It would run on its own judgement instead of fixed rules. Its reads,
            alerts and history stay.
          </p>
        </div>
      </div>
      <div className="mx-3.5 rounded-[10px] border border-border bg-card px-3 py-2">
        <p className="text-xs font-semibold text-muted-foreground">
          What it would do
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
          {plan.prompt}
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {scheduleWords(plan.schedule as BotSchedule)}
          {plan.gate === "changed" ? " · only when something changed" : ""}
        </p>
      </div>
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <Button
          size="sm"
          loading={convert.isPending}
          onClick={() =>
            convert.mutate(bot.id, {
              onSuccess: () =>
                useToastStore.getState().show(`${bot.name} is an agent now`),
              onError: (error) => useToastStore.getState().show(error.message),
            })
          }
        >
          Switch to agent
        </Button>
        <span className="text-xs text-muted-foreground">
          Only this bot. Others ask on their own pages.
        </span>
      </div>
    </section>
  );
}
