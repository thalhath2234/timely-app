"use client";
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import {
  MessageCircle,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import Conversation from "@/app/_components/chat/conversation";
import {
  groupChats,
  relativeTime,
  statusMeta,
} from "@/app/_components/chat/chatMeta";
import LoadError from "@/app/_components/_ui/loadError";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import {
  listContainerVariants,
  listItemVariants,
} from "@/app/_components/_ui/motion";
import { openContextMenu } from "@/app/_store/contextMenuStore";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { useChats, useDeleteChat, useRenameChat } from "@/app/utils/hooks/chat";
import type { ChatSummary } from "@/app/utils/api/chat";
import { cn } from "@/app/utils/cn";

const tone = {
  primary: "text-primary",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

function HistoryRow({
  chat,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  chat: ChatSummary;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const input = useRef<HTMLInputElement>(null);
  const openMenu = useContextMenu();
  const meta = statusMeta(chat.status);
  const Icon = meta.icon;
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const items = [
    {
      kind: "action" as const,
      label: "Rename",
      icon: Pencil,
      onSelect: () => {
        setTitle(chat.title);
        setEditing(true);
      },
    },
    { kind: "separator" as const },
    {
      kind: "action" as const,
      label: "Delete",
      icon: Trash2,
      danger: true,
      onSelect: onDelete,
    },
  ];
  function commit() {
    setEditing(false);
    const next = title.trim();
    if (next && next !== chat.title) onRename(next);
    else setTitle(chat.title);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setTitle(chat.title);
      setEditing(false);
    }
  }
  function more(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items,
      title: chat.title,
    });
  }
  return (
    <motion.div
      variants={listItemVariants}
      role="listitem"
      className={cn(
        "group mb-0.5 flex items-start gap-1 rounded-lg pr-1 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/70",
      )}
      onContextMenu={(e) => openMenu(e, items, { title: chat.title })}
    >
      {editing ? (
        <div className="flex min-w-0 flex-1 items-start gap-2.5 px-2.5 py-2">
          <span className={cn("mt-0.5 shrink-0", tone[meta.tone])}>
            <Icon className="size-3.5" />
          </span>
          <input
            ref={input}
            aria-label="Conversation title"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
            className="w-full min-w-0 rounded-md border border-ring bg-background px-1.5 py-0.5 text-sm outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          aria-label={`Open ${chat.title}`}
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className={cn("mt-0.5 shrink-0", tone[meta.tone])}>
            {meta.spin ? <LogoSpinner size={14} tone="mono" label={meta.label} /> : <Icon className="size-3.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-sm leading-5",
                chat.unread ? "font-semibold" : "font-medium",
                active && "text-primary",
              )}
            >
              {chat.title}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {["approval", "failed", "running", "queued"].includes(chat.status)
                ? meta.label
                : relativeTime(chat.updatedAt)}
            </span>
          </span>
          {chat.unread && (
            <span
              aria-label="Unread"
              className="mt-2 size-2 shrink-0 rounded-full bg-primary group-hover:hidden"
            />
          )}
        </button>
      )}
      {!editing && (
        <button
          type="button"
          aria-label={`More options for ${chat.title}`}
          onClick={more}
          className="mt-2.5 shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      )}
    </motion.div>
  );
}

function ChatPage() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const chats = useChats();
  const rename = useRenameChat();
  const remove = useDeleteChat();
  const toast = useToastStore((s) => s.show);
  const [filter, setFilter] = useState("");
  const [showHistory, setShowHistory] = useState(true);
  const [mobileHistory, setMobileHistory] = useState(false);
  const list = chats.data ?? [];
  const filtered = list.filter((c) =>
    c.title.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = groupChats(filtered);
  function open(path: string) {
    router.push(path);
    setMobileHistory(false);
  }
  function del(chat: ChatSummary) {
    requestConfirm({
      title: `Delete “${chat.title}”?`,
      description:
        "Its history, temporary images and notifications are removed. Changes already applied to your work stay.",
      confirmLabel: "Delete",
      onConfirm: async () => {
        try {
          await remove.mutateAsync(chat.id);
          if (id === chat.id) router.replace("/chat");
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
  const historyVisible = showHistory;
  return (
    <div className="relative flex h-full min-h-0">
      {mobileHistory && (
        <button
          type="button"
          aria-label="Hide history"
          onClick={() => setMobileHistory(false)}
          className="absolute inset-0 z-10 bg-black/40 md:hidden"
        />
      )}
      <aside
        aria-label="Chat history"
        className={cn(
          "z-20 flex w-72 shrink-0 flex-col border-r border-border bg-muted/20 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:bg-background max-md:shadow-xl",
          !historyVisible && "md:hidden",
          !mobileHistory && "max-md:hidden",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            Chats
            {list.some((c) => c.unread) && (
              <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
                {list.filter((c) => c.unread).length} new
              </span>
            )}
          </h2>
          <div className="flex items-center">
            <button
              type="button"
              aria-label="New chat"
              title="New chat"
              onClick={() => open("/chat")}
              className="rounded-lg p-2 text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Hide history"
              onClick={() => {
                setShowHistory(false);
                setMobileHistory(false);
              }}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-input/30 px-2.5 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              aria-label="Search conversations"
              placeholder="Search chats"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-4">
          {chats.isLoading && (
            <div
              role="status"
              aria-label="Loading history"
              className="space-y-2 px-2 pt-2"
            >
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-11 animate-pulse rounded-lg bg-muted"
                />
              ))}
            </div>
          )}
          {chats.error && !list.length && (
            <LoadError
              what="chat history"
              error={chats.error}
              onRetry={() => void chats.refetch()}
              retrying={chats.isFetching}
              className="m-2 py-8"
            />
          )}
          {!chats.isLoading && !chats.error && !filtered.length && (
            <div className="px-4 py-12 text-center text-xs leading-5 text-muted-foreground">
              <MessageCircle className="mx-auto mb-3 size-6 opacity-50" />
              {filter
                ? "No matching conversations."
                : "Your conversations will live here."}
            </div>
          )}
          <motion.div
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
            role="list"
          >
            {groups.map((group) => (
              <div key={group.label} className="pt-2">
                <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((chat) => (
                  <HistoryRow
                    key={chat.id}
                    chat={chat}
                    active={id === chat.id}
                    onOpen={() =>
                      open(`/chat?id=${encodeURIComponent(chat.id)}`)
                    }
                    onRename={(title) =>
                      rename.mutate(
                        { id: chat.id, title },
                        { onError: (e) => toast(e.message) },
                      )
                    }
                    onDelete={() => del(chat)}
                  />
                ))}
              </div>
            ))}
          </motion.div>
        </div>
        <div className="border-t border-border px-4 py-3 text-[11px] leading-5 text-muted-foreground">
          Chat from any screen with{" "}
          <kbd className="rounded border border-border bg-card px-1 font-sans font-medium text-foreground">
            Ctrl / ⌘ + Shift + J
          </kbd>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Conversation
          key={id || "new"}
          id={id}
          onCreated={(next) =>
            router.replace(`/chat?id=${encodeURIComponent(next)}`)
          }
          onNew={() => open("/chat")}
          historyOpen={historyVisible && !mobileHistory ? undefined : false}
          onToggleHistory={() => {
            if (window.innerWidth < 768) setMobileHistory(true);
            else setShowHistory(true);
          }}
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
