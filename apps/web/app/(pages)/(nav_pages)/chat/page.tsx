"use client";
import { Suspense, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MessageCircle,
  Plus,
  Search,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import Conversation from "@/app/_components/chat/conversation";
import { useChats } from "@/app/utils/hooks/chat";
import { cn } from "@/app/utils/cn";

function ChatPage() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const { data: chats = [], isLoading, error } = useChats();
  const [filter, setFilter] = useState("");
  const [showHistory, setShowHistory] = useState(true);
  const filtered = chats.filter((c) =>
    c.title.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="relative flex h-full min-h-0">
      <aside
        aria-label="Chat history"
        className={cn(
          "flex w-64 shrink-0 flex-col border-r border-border bg-muted/20 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:bg-background",
          !showHistory && "hidden",
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <h2 className="text-sm font-semibold">Conversations</h2>
          <button
            type="button"
            aria-label="Hide history"
            onClick={() => setShowHistory(false)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>
        <div className="px-3">
          <button
            type="button"
            onClick={() => {
              router.push("/chat");
              if (window.innerWidth < 768) setShowHistory(false);
            }}
            className="flex w-full items-center gap-2 rounded-xl bg-primary/10 px-3 py-3 text-sm font-medium text-primary hover:bg-primary/15"
          >
            <Plus className="size-4" />
            New chat
          </button>
          <label className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              aria-label="Search conversations"
              placeholder="Find a conversation"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-w-0 bg-transparent text-xs outline-none"
            />
          </label>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-auto px-2 pb-4">
          {isLoading && (
            <p className="p-3 text-xs text-muted-foreground">
              Loading history…
            </p>
          )}
          {error && (
            <p role="alert" className="p-3 text-xs text-destructive">
              {error.message}
            </p>
          )}
          {!isLoading && !error && !filtered.length && (
            <div className="px-4 py-10 text-center text-xs leading-6 text-muted-foreground">
              <MessageCircle className="mx-auto mb-3 size-6 opacity-50" />
              {filter
                ? "No matching conversations."
                : "Your conversations will live here."}
            </div>
          )}
          {filtered.map((chat) => (
            <button
              type="button"
              key={chat.id}
              onClick={() => {
                router.push(`/chat?id=${encodeURIComponent(chat.id)}`);
                if (window.innerWidth < 768) setShowHistory(false);
              }}
              className={cn(
                "mb-1 flex w-full items-start gap-2 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted",
                id === chat.id && "bg-primary/8 text-primary",
              )}
            >
              <div className="mt-0.5">
                {["running", "queued"].includes(chat.status) ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <MessageCircle className="size-3.5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium leading-5">
                  {chat.title}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {chat.status === "approval"
                    ? "Waiting for your approval"
                    : chat.status === "failed"
                      ? "Needs attention"
                      : new Date(chat.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                </p>
              </div>
              {chat.unread && (
                <span
                  aria-label="Unread"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                />
              )}
            </button>
          ))}
        </div>
        <div className="border-t border-border px-5 py-4 text-[11px] leading-5 text-muted-foreground">
          Chat from any screen
          <br />
          <kbd className="font-sans font-medium text-foreground">
            Ctrl / ⌘ + Shift + J
          </kbd>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {!showHistory && (
          <button
            type="button"
            aria-label="Show history"
            onClick={() => setShowHistory(true)}
            className="absolute right-16 top-5 z-10 rounded-lg p-1 text-muted-foreground hover:bg-muted"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        )}
        <Conversation
          key={id || "new"}
          id={id}
          onCreated={(next) =>
            router.replace(`/chat?id=${encodeURIComponent(next)}`)
          }
          onNew={() => router.push("/chat")}
        />
      </main>
    </div>
  );
}
const subscribe = () => () => {};
export default function Page() {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return ready ? (
    <Suspense>
      <ChatPage />
    </Suspense>
  ) : (
    <div className="h-full bg-background" />
  );
}
