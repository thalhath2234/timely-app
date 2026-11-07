"use client";

import { Clock, RefreshCw } from "lucide-react";
import { runNowState, type BotView } from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { useToastStore } from "@/app/_store/toastStore";
import { useRunBot } from "@/app/utils/hooks/bots";

const say = (message: string) => useToastStore.getState().show(message);

/**
 * Check now. While the site's floor holds the next check back it reads
 * "Checks at 00:12" and is disabled; the reason is in the panel's meta chips
 * ("Next 00:12 · shop pages wait 6 h"). Hidden while the bot is paused.
 */
export function RunNowButton({ bot, now }: { bot: BotView; now: Date }) {
  const run = useRunBot();
  const state = runNowState(bot, now);
  if (state.state === "hidden") return null;
  const checking = state.state === "checking" || run.isPending;
  return (
    <Button
      variant="outline"
      size="sm"
      leading={state.state === "cooldown" ? <Clock /> : <RefreshCw />}
      loading={checking}
      disabled={state.state === "cooldown"}
      onClick={() =>
        run.mutate(bot.id, {
          onSuccess: (result) => say(result.line),
          onError: (error) => say(error.message),
        })
      }
    >
      {checking ? "Checking…" : state.label}
    </Button>
  );
}
