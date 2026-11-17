"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { assistantHref } from "@timely/contract/assistant";
import { boardOrder } from "@timely/contract/bots";
import { SkeletonCards } from "@/app/_components/_ui/skeleton";
import { useNowMinute } from "@/app/_components/auth/clock";
import {
  BotPanel,
  leaveUnfinished,
  type Unfinished,
} from "@/app/_components/bots/botPanel";
import Conversation from "@/app/_components/chat/conversation";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { useBots } from "@/app/utils/hooks/bots";
import { useChats, useDeleteChat, useRenameChat } from "@/app/utils/hooks/chat";
import { cn } from "@/app/utils/cn";
import {
  buildInbox,
  filterInbox,
  type InboxChat,
  type InboxItem,
} from "./inbox";
import { InboxList } from "./inboxList";

/** What the right pane shows, read from the URL. */
type Open =
  | { kind: "chat"; id: string }
  | { kind: "bot"; id: string }
  | { kind: "new-bot"; starter: string | null; draft: string | null }
  | { kind: "new-chat" };

function readOpen(params: URLSearchParams): Open {
  const chat = params.get("chat");
  const bot = params.get("bot");
  const thread = params.get("thread");
  if (chat) return { kind: "chat", id: chat };
  // A new Bot's draft has no Bot yet: its row links the draft thread as both.
  if (bot && thread === bot)
    return { kind: "new-bot", starter: null, draft: thread };
  // Any other thread value opens the Bot panel on the Bot's own thread.
  if (bot) return { kind: "bot", id: bot };
  if (params.get("new") === "1")
    return { kind: "new-bot", starter: params.get("starter"), draft: null };
  return { kind: "new-chat" };
}

function selectedKey(open: Open): string | null {
  if (open.kind === "chat") return `chat:${open.id}`;
  if (open.kind === "bot") return `bot:${open.id}`;
  if (open.kind === "new-bot" && open.draft) return `draft:${open.draft}`;
  return null;
}

function Shell() {
  const router = useRouter();
  const params = useSearchParams();
  const open = readOpen(new URLSearchParams(params.toString()));
  const chats = useChats();
  const bots = useBots();
  const rename = useRenameChat();
  const remove = useDeleteChat();
  const toast = useToastStore((s) => s.show);
  const minute = useNowMinute();
  const now = useMemo(
    () => (minute === null ? null : new Date(minute * 60_000)),
    [minute],
  );
  const [filter, setFilter] = useState("");
  // On a phone the list and the pane share one column: the pane is open
  // when something is selected or a new chat was asked for.
  const [composing, setComposing] = useState(false);
  const selected = selectedKey(open);
  const paneOpen =
    composing || open.kind !== "new-chat" || params.has("chat");

  const full = useMemo(
    () =>
      now
        ? buildInbox(
            (chats.data ?? []) as InboxChat[],
            bots.data?.bots ?? [],
            now,
          )
        : { needs: [], recent: [] },
    [chats.data, bots.data, now],
  );
  const inbox = useMemo(() => filterInbox(full, filter), [full, filter]);
  const total = full.needs.length + full.recent.length;

  // A New bot draft, or an open Bot's unfinished edits, are asked about
  // before a click elsewhere replaces them.
  const unfinished = useRef<Unfinished>(null);
  const onUnfinished = useCallback((value: Unfinished) => {
    unfinished.current = value;
  }, []);
  const go = useCallback(
    (href: string) => {
      const leaving = open.kind === "bot" || open.kind === "new-bot";
      const proceed = () => {
        router.push(href, { scroll: false });
      };
      if (leaving) leaveUnfinished(unfinished.current, proceed);
      else proceed();
    },
    [open.kind, router],
  );

  const openItem = (item: InboxItem) => {
    setComposing(false);
    go(assistantHref(item.type === "chat" ? { chat: item.id } : { bot: item.id }));
  };
  const newChat = () => {
    setComposing(true);
    go(assistantHref());
  };
  const newBot = () => go("/assistant?new=1");
  const showList = () => {
    setComposing(false);
    if (open.kind !== "new-chat") go(assistantHref());
  };

  function del(id: string, title: string) {
    requestConfirm({
      title: `Delete “${title}”?`,
      description:
        "Its history, temporary images and notifications are removed. Changes already applied to your work stay.",
      confirmLabel: "Delete",
      onConfirm: async () => {
        try {
          await remove.mutateAsync(id);
          if (open.kind === "chat" && open.id === id)
            router.replace(assistantHref());
          toast("Conversation deleted");
        } catch (error) {
          toast(
            error instanceof Error
              ? error.message
              : "Couldn't delete this conversation.",
          );
        }
      },
    });
  }

  let pane;
  if (open.kind === "bot" || open.kind === "new-bot") {
    pane = now ? (
      <div className="h-full min-h-0 md:p-3">
        <BotPanel
          key={
            open.kind === "new-bot"
              ? `new-${open.starter ?? ""}-${open.draft ?? ""}`
              : "edit"
          }
          mode={open.kind === "new-bot" ? "new" : "edit"}
          botId={open.kind === "bot" ? open.id : null}
          starter={open.kind === "new-bot" ? open.starter : null}
          draft={open.kind === "new-bot" ? open.draft : null}
          listed={
            open.kind === "bot"
              ? bots.data?.bots.find((b) => b.id === open.id)
              : undefined
          }
          order={boardOrder(bots.data?.bots ?? [], now)}
          now={now}
          onClose={showList}
          onSelect={(id) => go(assistantHref({ bot: id }))}
          onUnfinished={onUnfinished}
        />
      </div>
    ) : (
      <SkeletonCards className="m-6" />
    );
  } else {
    const id = open.kind === "chat" ? open.id : null;
    pane = (
      <Conversation
        key={id || "new"}
        id={id}
        onCreated={(next) => router.replace(assistantHref({ chat: next }))}
        onNew={newChat}
        historyOpen
        onToggleHistory={showList}
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0">
      <InboxList
        className={cn(
          "w-full shrink-0 border-border bg-muted/20 md:w-80 md:border-r",
          paneOpen && "max-md:hidden",
        )}
        inbox={inbox}
        total={total}
        loading={
          (chats.isLoading || bots.isLoading || !now) &&
          !chats.data &&
          !bots.data
        }
        error={chats.error && bots.error ? chats.error : null}
        fetching={chats.isFetching || bots.isFetching}
        onRetry={() => {
          void chats.refetch();
          void bots.refetch();
        }}
        filter={filter}
        onFilter={setFilter}
        selected={selected}
        onOpen={openItem}
        onNewChat={newChat}
        onNewBot={newBot}
        onRename={(id, title) =>
          rename.mutate({ id, title }, { onError: (e) => toast(e.message) })
        }
        onDelete={del}
      />
      <main
        aria-label={
          open.kind === "bot" || open.kind === "new-bot" ? "Bot" : "Chat"
        }
        className={cn("min-w-0 flex-1", !paneOpen && "max-md:hidden")}
      >
        {pane}
      </main>
    </div>
  );
}

// useSearchParams needs a Suspense boundary for the page to prerender.
export default function AssistantShell() {
  return (
    <Suspense fallback={<SkeletonCards className="m-6" />}>
      <Shell />
    </Suspense>
  );
}
