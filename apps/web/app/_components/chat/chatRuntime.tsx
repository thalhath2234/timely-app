"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, X } from "lucide-react";
import Conversation from "./conversation";
import { useChatStore } from "@/app/_store/chatStore";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { useCalendarStore } from "@/app/_store/calendarStore";
import { useChats } from "@/app/utils/hooks/chat";
import type { ChatContext } from "@/app/utils/api/chat";

export default function ChatRuntime() {
  const { open: overlayOpen, openNew, close } = useChatStore();
  const cache = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const { data: chats } = useChats();
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    function open(event: KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        !event.shiftKey ||
        event.key.toLowerCase() !== "j"
      )
        return;
      event.preventDefault();
      const chips: ChatContext[] = [
        {
          kind: "location",
          label:
            pathname
              .split("/")
              .filter(Boolean)[0]
              ?.replace(/^./, (c) => c.toUpperCase()) || "Current screen",
          value: location.pathname + location.search,
        },
      ];
      const detail = useEntityDetailStore.getState();
      const match = pathname.match(/^\/(docs|sheets|projects)\/([^/]+)/);
      const kind = detail.id ? detail.kind : match?.[1];
      const entityId = detail.id || match?.[2];
      if (kind && entityId) {
        const plural =
          kind === "task" ? "tasks" : kind === "project" ? "projects" : kind;
        const data = cache.getQueryData<Record<string, unknown>>([
          plural,
          entityId,
        ]);
        chips.push({
          kind: "object",
          label: String(data?.title || data?.name || `Open ${kind}`),
          value: `${plural}/${entityId}`,
        });
        if (typeof data?.workspaceId === "string")
          chips.push({
            kind: "workspace",
            label: "Current workspace",
            value: data.workspaceId,
          });
        if (plural === "projects" || typeof data?.projectId === "string")
          chips.push({
            kind: "project",
            label: "Current project",
            value: plural === "projects" ? entityId : String(data?.projectId),
          });
      }
      const text = window.getSelection()?.toString().trim();
      if (text)
        chips.push({
          kind: "selection",
          label: "Selected text",
          value: text.slice(0, 12000),
        });
      const grid = document.querySelector<HTMLElement>(
        "[data-chat-sheet-range]",
      );
      if (kind === "sheets" && entityId && grid?.dataset.chatSheetTab)
        chips.push({
          kind: "sheet-tab",
          label: "Current sheet tab",
          value: `sheets/${entityId}/tabs/${grid.dataset.chatSheetTab}`,
        });
      if (grid?.dataset.chatSheetRange)
        chips.push({
          kind: "selection",
          label: `Cells ${grid.dataset.chatSheetRange}`,
          value: `${grid.dataset.chatSheetRange}; tab ${grid.dataset.chatSheetTab || "primary"}`,
        });
      if (pathname.startsWith("/calendar")) {
        const calendar = useCalendarStore.getState();
        chips.push({
          kind: "calendar",
          label: "Calendar view",
          value: `${calendar.activeView}: ${calendar.selectedDate.toLocaleDateString("en-CA")}`,
        });
      }
      openNew(chips);
    }
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, [cache, pathname, openNew]);
  useEffect(() => {
    if (!chats || !window.timelyDesktop?.notifyChat) return;
    for (const chat of chats) {
      const version = `${chat.status}:${chat.revision}`;
      const previous = seen.current.get(chat.id);
      seen.current.set(chat.id, version);
      if (
        chat.unread &&
        ["idle", "approval", "failed"].includes(chat.status) &&
        previous !== version
      ) {
        window.timelyDesktop.notifyChat({
          id: chat.id,
          title: chat.title,
          body:
            chat.status === "approval"
              ? "Your changes are ready to review."
              : chat.status === "failed"
                ? "Your chat needs attention."
                : "Your chat has a new update.",
          revision: chat.revision,
        });
      }
    }
  }, [chats]);
  useEffect(
    () =>
      window.timelyDesktop?.onOpenChat?.((id) => {
        close();
        router.push(`/chat?id=${encodeURIComponent(id)}`);
      }),
    [router, close],
  );
  return overlayOpen ? <ChatOverlay /> : null;
}
function ChatOverlay() {
  const { context, conversationId, setId, close } = useChatStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      aria-label="Chat with Timely"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="fixed inset-0 m-auto h-[min(820px,90dvh)] max-h-[90dvh] w-[min(760px,94vw)] max-w-none overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/45 backdrop:backdrop-blur-sm"
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-5 py-2">
          <span className="text-xs text-muted-foreground">Chat in context</span>
          <div className="flex items-center gap-1">
            {conversationId && (
              <button
                type="button"
                aria-label="Open in Chat tab"
                onClick={() => {
                  close();
                  router.push(`/chat?id=${encodeURIComponent(conversationId)}`);
                }}
                className="rounded-lg p-2 hover:bg-muted"
              >
                <ArrowUpRight className="size-4" />
              </button>
            )}
            <button
              type="button"
              aria-label="Close chat"
              onClick={close}
              className="rounded-lg p-2 hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <Conversation
            id={conversationId}
            initialContext={context}
            onCreated={setId}
            compact
          />
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
