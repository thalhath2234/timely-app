"use client";

import { useRouter } from "next/navigation";
import type { BotView, FixAction } from "@timely/contract/bots";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import {
  useApplySuggestion,
  useDeleteBot,
  useDismissSuggestion,
  useResumeBot,
  useRunBot,
} from "@/app/utils/hooks/bots";

/** Where the Finnhub key row lives (Settings › Agent). */
export const BOT_KEYS_HREF = "/settings?tab=agent#bot-keys";

const say = (message: string) => useToastStore.getState().show(message);
const failed = (error: Error) => say(error.message);

/**
 * What the board's buttons do. Fixes that need the editor (pick the part,
 * edit, change source) open the bot; Check now, Resume and Turn on act in
 * place; Add key goes to the key row. A suggested change is applied or put
 * off ("Not now") in place too.
 */
export function useBotActions(onOpen: (id: string) => void) {
  const router = useRouter();
  const run = useRunBot();
  const resume = useResumeBot();
  const remove = useDeleteBot();
  const apply = useApplySuggestion();
  const dismiss = useDismissSuggestion();

  const act = (bot: BotView, action: FixAction | "edit") => {
    switch (action) {
      case "check_now":
        run.mutate(bot.id, {
          onSuccess: (result) => say(result.line),
          onError: failed,
        });
        return;
      case "resume":
      case "turn_on":
        resume.mutate(bot.id, {
          onSuccess: () =>
            say(
              action === "turn_on"
                ? `${bot.name} is on`
                : `${bot.name} is watching again`,
            ),
          onError: failed,
        });
        return;
      case "apply_suggestion":
        if (!bot.suggestion) return;
        apply.mutate(
          { botId: bot.id, id: bot.suggestion.id },
          { onSuccess: () => say(`${bot.name} changed`), onError: failed },
        );
        return;
      case "dismiss_suggestion":
        dismiss.mutate(bot.id, { onError: failed });
        return;
      case "add_key":
        router.push(BOT_KEYS_HREF);
        return;
      default:
        onOpen(bot.id);
    }
  };

  const askDelete = (bot: BotView) =>
    requestConfirm({
      title: `Delete ${bot.name}?`,
      description: "Its log, alerts and price history go too.",
      confirmLabel: "Delete",
      pendingLabel: "Deleting…",
      onConfirm: async () => {
        try {
          await remove.mutateAsync(bot.id);
        } catch (error) {
          failed(error as Error);
        }
      },
    });

  /** The action running for this bot now, so its button shows the spinner. */
  const busy = (bot: BotView): FixAction | null => {
    if (run.isPending && run.variables === bot.id) return "check_now";
    if (resume.isPending && resume.variables === bot.id) return "resume";
    if (apply.isPending && apply.variables?.botId === bot.id)
      return "apply_suggestion";
    if (dismiss.isPending && dismiss.variables === bot.id)
      return "dismiss_suggestion";
    return null;
  };

  return { act, askDelete, busy };
}
