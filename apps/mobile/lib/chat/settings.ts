import type { ModelChoice } from "../../components/chat/ModelSheet";
import type { Chat, ChatContext } from "./types";

export type ChatSettings = {
  context: ChatContext[];
  webSearch: boolean;
  model: ModelChoice;
};

export function settingsOf(chat: Chat): ChatSettings {
  return {
    context: chat.context ?? [],
    webSearch: !!chat.webSearch,
    model: {
      provider: chat.chosenProvider ?? "",
      model: chat.chosenModel ?? "",
    },
  };
}

const chips = (context: ChatContext[]) =>
  JSON.stringify(context.map((c) => [c.kind, c.label, c.value]));

export function changed(
  next: Partial<ChatSettings>,
  shown: ChatSettings,
): Partial<ChatSettings> | undefined {
  const fields: Partial<ChatSettings> = {};
  if (next.context && chips(next.context) !== chips(shown.context))
    fields.context = next.context;
  if (next.webSearch !== undefined && next.webSearch !== shown.webSearch)
    fields.webSearch = next.webSearch;
  if (
    next.model &&
    (next.model.provider !== shown.model.provider ||
      next.model.model !== shown.model.model)
  )
    fields.model = next.model;
  return Object.keys(fields).length ? fields : undefined;
}
