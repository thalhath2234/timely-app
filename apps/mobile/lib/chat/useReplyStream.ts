import { useEffect, useRef, useState } from "react";
import type { ReplyDraft } from "@timely/contract/agentChat";
import { watchChats } from "../api/chatStream";
import { mergeActivityDraft, onDelta, visibleDraft, wantsReplyStream } from "./agentRun";
import type { Chat } from "./types";

/** At most one refetch a second when chunks go missing. */
const REFETCH_GAP = 1000;

/**
 * The open chat's reply as an agent run writes it (Q-2.5). While the run is
 * live it follows `GET /chats/watch` and applies each `delta` with the
 * contract's applyDelta; a missed chunk refetches the chat and continues
 * from `activity.draft`. A `changed` event for this chat refetches it too.
 * When the stream can't be read, `live` stays false and the chat keeps
 * polling as before; the final reply always arrives as the refetched chat.
 */
export function useReplyStream({
  chatId,
  chat,
  enabled,
  accountEngine,
  refetch,
}: {
  chatId: string | null;
  chat: Chat | undefined;
  /** Open, in the foreground and online. */
  enabled: boolean;
  accountEngine: string | undefined;
  refetch: () => void;
}): { draft: string; live: boolean } {
  const want = enabled && !!chatId && wantsReplyStream(chat, accountEngine);
  const [draft, setDraftState] = useState<ReplyDraft | null>(null);
  const [live, setLive] = useState(false);
  const draftRef = useRef<ReplyDraft | null>(null);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const lastRefetch = useRef(0);
  const setDraft = (next: ReplyDraft | null) => {
    if (next === draftRef.current) return;
    draftRef.current = next;
    setDraftState(next);
  };

  // A refetched chat: a late join starts from activity.draft, and the run's
  // end (no activity) drops the draft for the saved reply. Another chat
  // starts from its own activity, never from this one's text.
  const shownChat = useRef(chatId);
  useEffect(() => {
    const current = shownChat.current === chatId ? draftRef.current : null;
    shownChat.current = chatId;
    setDraft(mergeActivityDraft(current, chat?.id === chatId ? chat?.activity : undefined));
  }, [chatId, chat?.id, chat?.activity?.run, chat?.activity?.draft, chat?.status]);

  useEffect(() => {
    if (!want) {
      setLive(false);
      return;
    }
    const controller = new AbortController();
    const refetchSoon = () => {
      const now = Date.now();
      if (now - lastRefetch.current < REFETCH_GAP) return;
      lastRefetch.current = now;
      refetchRef.current();
    };
    watchChats((message) => {
      if (message.type === "live") setLive(message.live);
      else if (message.type === "changed") {
        if (message.id === chatId) refetchRef.current();
      } else {
        const result = onDelta(chatId, draftRef.current, message.event);
        setDraft(result.draft);
        if (result.refetch) refetchSoon();
      }
    }, controller.signal);
    return () => {
      controller.abort();
      setLive(false);
    };
  }, [want, chatId]);

  return { draft: visibleDraft(chat, draft), live };
}
