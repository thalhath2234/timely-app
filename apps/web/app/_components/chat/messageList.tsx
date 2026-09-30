"use client";
import { useState } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  History,
  Info,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { Chat, ChatMessage } from "@/app/utils/api/chat";
import { cn } from "@/app/utils/cn";
import ChatText from "./chatText";
import ChangeCards from "./changeCards";
import { ImagePreview } from "./imageAttachments";
import { ReceiptSummary } from "./receiptReview";
import { timeOfDay } from "./chatMeta";

function NoticeIcon({ content }: { content: string }) {
  const className = "size-3.5 shrink-0";
  if (/^stopped/i.test(content)) return <Ban className={className} />;
  if (/^done/i.test(content) || /confirmed/i.test(content))
    return <CheckCircle2 className={className} />;
  if (/changed before applying/i.test(content))
    return <RefreshCw className={className} />;
  return <Info className={className} />;
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const diff =
    start.getTime() -
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (diff <= 0) return "Today";
  if (diff <= 86400000) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function Notice({ message }: { message: ChatMessage }) {
  return (
    <div
      role="status"
      className="mx-auto flex max-w-lg items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
    >
      <NoticeIcon content={message.content} />
      <span className="truncate">{message.content}</span>
      <span className="ml-1 shrink-0 tabular-nums opacity-70">
        {timeOfDay(message.createdAt)}
      </span>
    </div>
  );
}

function Archive({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const steps = message.steps || [];
  const done = steps.filter((s) => s.status === "done").length;
  const discarded = message.content.toLowerCase().includes("discard");
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <History className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {discarded ? "Discarded proposal" : "Earlier proposal"} ·{" "}
          {steps.length} {steps.length === 1 ? "change" : "changes"}
          {done ? `, ${done} applied` : ""}
        </span>
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="border-t border-dashed border-border p-3">
          <ChangeCards steps={steps} muted />
        </div>
      )}
    </div>
  );
}

export default function MessageList({ chat }: { chat: Chat }) {
  let lastDay = "";
  return (
    <div
      className="space-y-5"
      role="log"
      aria-live="polite"
      aria-label="Conversation messages"
    >
      {chat.messages?.map((m) => {
        const day = dayLabel(m.createdAt);
        const separator = day !== lastDay;
        lastDay = day;
        const isUser = m.role === "user" && !m.kind;
        return (
          <div key={m.id} className="space-y-5">
            {separator && (
              <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {day}
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            {m.kind === "notice" ? (
              <Notice message={m} />
            ) : m.kind === "archive" ? (
              <Archive message={m} />
            ) : isUser ? (
              <div className="group flex flex-col items-end gap-1">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground shadow-sm">
                  <ChatText
                    text={m.content}
                    className="text-primary-foreground"
                  />
                  {!!m.imageIds?.length && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {chat.images
                        ?.filter((image) => m.imageIds?.includes(image.id))
                        .map((image) => (
                          <ImagePreview key={image.id} image={image} />
                        ))}
                    </div>
                  )}
                </div>
                <span className="pr-1 text-[11px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {timeOfDay(m.createdAt)}
                </span>
              </div>
            ) : (
              <div className="group flex gap-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold">Timely</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      {timeOfDay(m.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1">
                    <ChatText text={m.content} />
                  </div>
                  {!!m.imageIds?.length && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {chat.images
                        ?.filter((image) => m.imageIds?.includes(image.id))
                        .map((image) => (
                          <ImagePreview key={image.id} image={image} />
                        ))}
                    </div>
                  )}
                  {m.receipt && <ReceiptSummary receipt={m.receipt} />}
                  {!!m.steps?.length && (
                    <div className="mt-3">
                      <ChangeCards steps={m.steps} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
