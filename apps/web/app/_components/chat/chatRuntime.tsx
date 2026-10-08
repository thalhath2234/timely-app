"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Conversation from "./conversation";
import { useChatStore } from "@/app/_store/chatStore";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { useCalendarStore } from "@/app/_store/calendarStore";
import { useChats } from "@/app/utils/hooks/chat";
import type { ChatContext } from "@/app/utils/api/chat";
import { cn } from "@/app/utils/cn";
import { morphIntoIsland } from "@/app/_components/_layout/activityIsland";

export default function ChatRuntime() {
  const { open: overlayOpen, openNew, close } = useChatStore();
  const cache = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const { data: chats } = useChats();
  const seen = useRef<Map<string, string> | null>(null);
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
    // The first poll only records what already happened; it must not replay
    // every unread chat as a fresh desktop notification.
    const first = seen.current === null;
    const map = seen.current ?? new Map<string, string>();
    seen.current = map;
    for (const chat of chats) {
      const version = `${chat.status}:${chat.revision}`;
      const previous = map.get(chat.id);
      map.set(chat.id, version);
      if (
        !first &&
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
  const { context, conversationId, close, openNew, track } = useChatStore();
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
      role="dialog"
      aria-label="Chat with Timely"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      // Opens as a floating prompt bar near the bottom of the page (no dimmed
      // backdrop). Sending shrinks it into the Activity island; opening a chat
      // from the island shows it here as a panel.
      className={cn(
        "fixed inset-0 mx-auto mb-[max(1.5rem,5dvh)] mt-auto max-h-[85dvh] w-[min(760px,94vw)] max-w-none p-0 text-foreground backdrop:bg-transparent open:animate-[vt-panel-in_220ms_cubic-bezier(0.22,1,0.36,1)_both] motion-safe:transition-[height] motion-safe:duration-300 motion-reduce:open:animate-none [interpolate-size:allow-keywords]",
        conversationId
          ? "h-[min(720px,80dvh)] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
          : "h-fit overflow-visible bg-transparent",
      )}
    >
      <div className="flex h-full flex-col">
        <Conversation
          key={conversationId || "new"}
          id={conversationId}
          initialContext={context}
          onCreated={(id) =>
            morphIntoIsland(dialog.current, () => {
              track(id);
              close();
            })
          }
          onNew={conversationId ? () => openNew([]) : undefined}
          onOpenFull={
            conversationId
              ? () => {
                  close();
                  router.push(`/chat?id=${encodeURIComponent(conversationId)}`);
                }
              : undefined
          }
          onClose={close}
          variant="overlay"
        />
      </div>
    </dialog>,
    document.body,
  );
}
