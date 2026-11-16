"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Bot, ChevronDown, ChevronRight, MessageCircle, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { SkeletonRows } from "@/app/_components/_ui/skeleton";
import LoadError from "@/app/_components/_ui/loadError";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import Button from "@/app/_components/_ui/button";
import { BotMark, botSites } from "@/app/_components/bots/botMark";
import { relativeTime, statusMeta } from "@/app/_components/chat/chatMeta";
import { openContextMenu } from "@/app/_store/contextMenuStore";
import { useBotIcons } from "@/app/utils/hooks/bots";
import { useBotThreads } from "@/app/utils/hooks/chat";
import { cn } from "@/app/utils/cn";
import { applyBotThreads, botNeedsLine, filterInbox, type DraftsItem, type Inbox, type InboxItem } from "./inbox";

const TONE = {
  primary: "text-primary",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

const RUNNING = ["approval", "host_approval", "choose", "failed", "running", "queued"];

type Rowish = {
  onOpen: (item: InboxItem) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
  selected: string | null;
  icons: Record<string, string | null> | undefined;
};

/** One row: a chat or a Bot, the same height and anatomy in both lists. */
function Row({ item, selected, icons, onOpen, onRename, onDelete }: Rowish & { item: InboxItem }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const input = useRef<HTMLInputElement>(null);
  const openMenu = useContextMenu();
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const chat = item.type === "chat" ? item.chat : null;
  const meta = chat ? statusMeta(chat.status, chat.question, chat.hostRequest) : null;
  const active = selected === `${item.type}:${item.id}`;

  const menu = chat
    ? [
        {
          kind: "action" as const,
          label: "Rename",
          icon: Pencil,
          onSelect: () => {
            setTitle(item.title);
            setEditing(true);
          },
        },
        { kind: "separator" as const },
        {
          kind: "action" as const,
          label: "Delete",
          icon: Trash2,
          danger: true,
          onSelect: () => onDelete(item.id, item.title),
        },
      ]
    : null;

  function commit() {
    setEditing(false);
    const next = title.trim();
    if (next && next !== item.title) onRename(item.id, next);
    else setTitle(item.title);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setTitle(item.title);
      setEditing(false);
    }
  }
  function more(e: MouseEvent<HTMLButtonElement>) {
    if (!menu) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu({ x: rect.left, y: rect.bottom + 4, items: menu, title: item.title });
  }

  let lead;
  let sub: string;
  let subTone = "text-muted-foreground";
  let at = item.at ? relativeTime(new Date(item.at).toISOString()) : "";
  if (item.type === "chat" && meta) {
    const Icon = meta.icon;
    lead = (
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-[10px] bg-muted", TONE[meta.tone])}>
        {meta.spin ? <LogoSpinner size={14} tone="mono" label={meta.label} /> : <Icon className="size-4" />}
      </span>
    );
    sub = RUNNING.includes(item.chat.status) || item.needs ? meta.label : "Chat";
    if (item.needs) subTone = TONE[meta.tone];
  } else if (item.type === "bot") {
    lead = <BotMark watches={item.bot.watches} kind={item.bot.kind} size={32} icons={icons} badge={false} />;
    if (item.needs) {
      sub = botNeedsLine(item);
      subTone = "text-warning";
    } else sub = item.bot.status === "paused" ? "Bot · paused" : "Bot";
    if (!item.at) at = "";
  } else if (item.type === "draft") {
    lead = (
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-muted text-primary">
        <Bot className="size-4" />
      </span>
    );
    sub = botNeedsLine(item);
    subTone = "text-warning";
  } else {
    lead = null;
    sub = "";
  }

  return (
    <div
      role="listitem"
      className={cn("group relative flex items-center gap-1 pr-1.5 transition-colors", active ? "bg-primary/10" : "hover:bg-muted/60")}
      onContextMenu={menu ? (e) => openMenu(e, menu, { title: item.title }) : undefined}
    >
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">
          {lead}
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
          aria-label={`Open ${item.title}`}
          onClick={() => onOpen(item)}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          {lead}
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-[13px] leading-5", item.unread ? "font-semibold" : "font-medium", active && "text-primary")}>
              {item.title}
            </span>
            <span className={cn("block truncate text-xs leading-4", subTone)}>{sub}</span>
          </span>
          {at ? <span className="shrink-0 self-start pt-0.5 text-[11px] text-muted-foreground group-hover:hidden">{at}</span> : null}
          {item.unread ? <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-primary group-hover:hidden" /> : null}
        </button>
      )}
      {menu && !editing ? (
        <button
          type="button"
          aria-label={`More options for ${item.title}`}
          onClick={more}
          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** The older unfinished drafts as one row that opens to list them in place. */
function DraftsRow({ item, ...row }: Rowish & { item: DraftsItem }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <div role="listitem" className="group relative flex items-center gap-1 pr-1.5 transition-colors hover:bg-muted/60">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${item.title}, ${open ? "hide" : "show"}`}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-muted text-muted-foreground">
            <Bot className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-5">{item.title}</span>
            <span className="block truncate text-xs leading-4 text-muted-foreground">New bots you didn’t finish</span>
          </span>
          <Chevron className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
      {open ? item.drafts.map((draft) => <Row key={`draft:${draft.id}`} item={draft} {...row} />) : null}
    </>
  );
}

function Group({ label, count, items, ...row }: Rowish & { label: string; count?: number; items: InboxItem[] }) {
  if (!items.length) return null;
  return (
    <section aria-label={label} className="pt-3 first:pt-0">
      <p className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
        {count ? <span className="rounded-full bg-warning/15 px-1.5 text-[11px] font-medium normal-case tracking-normal text-warning">{count}</span> : null}
      </p>
      <div role="list" className="divide-y divide-border overflow-hidden rounded-[12px] border border-border bg-card">
        {items.map((item) =>
          item.type === "drafts" ? (
            <DraftsRow key={`${item.type}:${item.id}`} item={item} {...row} />
          ) : (
            <Row key={`${item.type}:${item.id}`} item={item} {...row} />
          ),
        )}
      </div>
    </section>
  );
}

/**
 * The left column of the Assistant: a search box, Needs you (chats and Bots
 * that wait on the person) and a mixed recent list, one card of rows each.
 */
export function InboxList({
  inbox,
  total,
  loading,
  error,
  fetching,
  onRetry,
  filter,
  onFilter,
  selected,
  onOpen,
  onNewChat,
  onNewBot,
  onRename,
  onDelete,
  className,
}: {
  inbox: Inbox;
  /** Rows before the search box filtered them. */
  total: number;
  loading: boolean;
  error: unknown;
  fetching: boolean;
  onRetry: () => void;
  filter: string;
  onFilter: (value: string) => void;
  /** `chat:<id>` or `bot:<id>` of the open row. */
  selected: string | null;
  onOpen: (item: InboxItem) => void;
  onNewChat: () => void;
  onNewBot: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
  className?: string;
}) {
  // Bot threads wait on parked steps, one-tap changes and Review cards: they
  // put their Bot in Needs you, and a new Bot's draft gets a row of its own.
  const router = useRouter();
  const threads = useBotThreads().data;
  const listed = useMemo(() => filterInbox(applyBotThreads(inbox, threads), filter), [inbox, threads, filter]);
  const sites = useMemo(
    () => botSites([...listed.needs, ...listed.recent].flatMap((i) => (i.type === "bot" ? i.bot.watches : []))),
    [listed],
  );
  const icons = useBotIcons(sites).data;
  const open = (item: InboxItem) => {
    if ((item.type === "bot" || item.type === "draft") && item.href) router.push(item.href, { scroll: false });
    else onOpen(item);
  };
  const empty = !loading && !listed.needs.length && !listed.recent.length;
  const row = { onOpen: open, onRename, onDelete, selected, icons };
  return (
    <aside aria-label="Assistant inbox" className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <h1 className="text-base font-semibold tracking-tight">Assistant</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" leading={<Plus />} onClick={onNewBot} aria-label="New bot">
            Bot
          </Button>
          <Button variant="outline" size="sm" leading={<Plus />} onClick={onNewChat} aria-label="New chat">
            Chat
          </Button>
        </div>
      </div>
      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-input bg-card px-2.5 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            aria-label="Search chats and Bots"
            placeholder="Search chats and Bots"
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {loading ? <SkeletonRows rows={6} height={52} /> : null}
        {error && !total ? (
          <LoadError what="your chats and Bots" error={error} onRetry={onRetry} retrying={fetching} className="py-8" />
        ) : null}
        {empty && !error ? (
          <div className="px-4 py-12 text-center text-xs leading-5 text-muted-foreground">
            <MessageCircle className="mx-auto mb-3 size-6 opacity-50" />
            {filter ? "No matching chats or Bots." : "Your chats and Bots will live here."}
          </div>
        ) : null}
        <Group label="Needs you" count={listed.needs.length} items={listed.needs} {...row} />
        <Group label="Recent" items={listed.recent} {...row} />
      </div>
    </aside>
  );
}
