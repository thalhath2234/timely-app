import { useRouter } from "expo-router";
import { primaryWatch, type BotView, type FixAction } from "@timely/contract/bots";
import { useAssistant } from "../chat/AssistantProvider";
import { useResumeBot, useRunBot } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";

/** Settings › Agent opens the Finnhub key sheet on `?open=` this, when no usable key is saved. */
export const BOT_KEYS_SECTION = "bot-keys";

/** Where the Finnhub key row lives (Settings › Agent). */
export const BOT_KEYS_ROUTE = `/(app)/settings/agent?open=${BOT_KEYS_SECTION}`;

const say = (message: string) => useToastStore.getState().show(message);
const failed = (error: Error) => say(error.message);

/**
 * What the board's buttons do, as on the web. Fixes that need the editor
 * (pick the part, change the address or source) open the bot on its failing
 * watch's page; Edit opens the bot; Check now, Resume and Turn on act in
 * place; Add key goes to the key row.
 */
export function useBotActions(onOpen: (id: string, watchId?: string) => void) {
  const router = useRouter();
  const run = useRunBot();
  const resume = useResumeBot();

  const act = (bot: BotView, action: FixAction | "edit") => {
    switch (action) {
      case "check_now":
        run.mutate(bot.id, { onSuccess: (result) => say(result.line), onError: failed });
        return;
      case "resume":
      case "turn_on":
        resume.mutate(bot.id, {
          onSuccess: () => say(action === "turn_on" ? `${bot.name} is on` : `${bot.name} is watching again`),
          onError: failed,
        });
        return;
      case "add_key":
        router.push(BOT_KEYS_ROUTE as never);
        return;
      case "pick_part":
      case "edit_url":
      case "change_source":
        onOpen(bot.id, primaryWatch(bot)?.id);
        return;
      default:
        onOpen(bot.id);
    }
  };

  /** The action running for this bot now, so its button shows the spinner. */
  const busy = (bot: BotView): FixAction | null => {
    if (run.isPending && run.variables === bot.id) return "check_now";
    if (resume.isPending && resume.variables === bot.id) return "resume";
    return null;
  };

  return { act, busy };
}

export type BotActions = ReturnType<typeof useBotActions>;

/**
 * Opens the assistant on a new chat about bots, with `text` in the composer
 * ("Describe in chat" on a starter); with no text it opens the chat as the
 * pinch does. The assistant builds its draft for this screen when it opens,
 * so the words go in after that.
 */
export function useDescribeInChat() {
  const assistant = useAssistant();
  return (text?: string) => {
    const sending = Boolean(assistant.cache.draft?.requestId);
    assistant.open();
    // Signed out or still loading: open() showed nothing, so leave the draft.
    if (!text || sending || !assistant.hydrated) return;
    assistant.setDraft((draft) => ({ ...draft, text, conversationId: undefined, requestId: undefined }));
    assistant.select(null);
  };
}
