"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ImagePlus,
  PanelLeftOpen,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import TimelyLogo, { LogoSpinner, SPINNER_LOOP_SECONDS } from "@/app/_components/_ui/timelyLogo";
import { chatRequest, type Chat, type ChatContext } from "@/app/utils/api/chat";
import { chatKey, chatsKey, useChat } from "@/app/utils/hooks/chat";
import { cn } from "@/app/utils/cn";
import LoadError from "@/app/_components/_ui/loadError";
import Composer from "./composer";
import EmptyHero from "./emptyHero";
import MessageList from "./messageList";
import ProposalPanel from "./proposalPanel";
import ReceiptReview from "./receiptReview";
import { useImageUploads } from "./imageAttachments";
import { isBusy, phaseLabel, statusMeta } from "./chatMeta";
import { PROVIDER_LABELS, type ProviderId } from "@/app/utils/api/agentProviders";

const iconButton =
  "rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

const toneClass = {
  primary: "bg-primary/10 text-primary",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

export function StatusPill({
  status,
  phase,
}: {
  status: string;
  phase?: string;
}) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        toneClass[meta.tone],
      )}
    >
      {meta.spin ? <LogoSpinner size={12} tone="mono" label={meta.label} /> : <Icon className="size-3" />}
      {status === "running" && phase === "apply" ? "Applying" : meta.label}
    </span>
  );
}

const invalidated = [
  "tasks",
  "projects",
  "docs",
  "sheets",
  "workspaces",
  "calendar",
  "today",
  "inbox",
  "notifications",
];

export default function Conversation({
  id,
  initialContext = [],
  onCreated,
  onNew,
  variant = "page",
  historyOpen,
  onToggleHistory,
  onOpenFull,
  onClose,
}: {
  id?: string | null;
  initialContext?: ChatContext[];
  onCreated: (id: string) => void;
  onNew?: () => void;
  variant?: "page" | "overlay";
  historyOpen?: boolean;
  onToggleHistory?: () => void;
  onOpenFull?: () => void;
  onClose?: () => void;
}) {
  const compact = variant === "overlay";
  const query = useChat(id);
  const cache = useQueryClient();
  const chat = query.data;
  const [draft, setDraft] = useState("");
  const [receiptDirty, setReceiptDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const uploads = useImageUploads();
  const [context, setContext] = useState(initialContext);
  const [search, setSearch] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const receiptAnchor = useRef<HTMLDivElement>(null);
  const lastRevision = useRef<number | null>(null);
  const busy = isBusy(chat?.status);
  const chips = chat?.context || context;
  const webSearch = chat?.webSearch ?? search;
  const mutation = useMutation({
    mutationFn: async ({
      action,
      body,
    }: {
      action: string;
      body?: unknown;
    }) => {
      if (!id)
        return chatRequest<Chat>("", "POST", {
          content: draft.trim(),
          imageIds: uploads.images.map((i) => i.id),
          context,
          webSearch: search,
        });
      return chatRequest<Chat>(
        `/${encodeURIComponent(id)}${action}`,
        action === "" ? "PATCH" : "POST",
        body,
      );
    },
    onSuccess: (next, vars) => {
      cache.setQueryData(chatKey(next.id), next);
      void cache.invalidateQueries({ queryKey: chatsKey });
      if (!id) onCreated(next.id);
      if (!id || vars.action === "/messages") {
        setDraft("");
        uploads.sent();
      }
      if (vars.action !== "") setReceiptDirty(false);
    },
  });
  useEffect(() => {
    input.current?.focus();
  }, [id]);
  useEffect(() => {
    if (!chat?.messages?.length) return;
    if (chat.imageReview?.status === "review" && chat.phase === "review")
      receiptAnchor.current?.scrollIntoView({
        behavior: "instant",
        block: "start",
      });
    else bottom.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [
    chat?.messages?.length,
    chat?.status,
    chat?.imageReview?.status,
    chat?.phase,
  ]);
  useEffect(() => {
    if (!chat) return;
    function markRead() {
      if (!chat?.unread || !document.hasFocus()) return;
      void chatRequest(`/${encodeURIComponent(chat.id)}/read`, "POST").then(
        () => {
          cache.setQueryData<Chat>(chatKey(chat.id), (c) =>
            c ? { ...c, unread: false } : c,
          );
          void cache.invalidateQueries({ queryKey: chatsKey });
          void cache.invalidateQueries({ queryKey: ["notifications"] });
        },
      );
    }
    markRead();
    window.addEventListener("focus", markRead);
    // Every completed run can touch other screens' data.
    if (
      lastRevision.current !== null &&
      lastRevision.current !== chat.revision &&
      !isBusy(chat.status)
    )
      for (const key of invalidated)
        void cache.invalidateQueries({ queryKey: [key] });
    lastRevision.current = chat.revision;
    return () => window.removeEventListener("focus", markRead);
  }, [chat, cache]);
  function send() {
    if (
      (!draft.trim() && !uploads.images.length) ||
      uploads.uploading ||
      mutation.isPending ||
      busy
    )
      return;
    mutation.mutate({
      action: "/messages",
      body: {
        content: draft.trim(),
        imageIds: uploads.images.map((i) => i.id),
      },
    });
  }
  function configure(nextContext: ChatContext[], nextSearch: boolean) {
    if (id)
      mutation.mutate({
        action: "",
        body: { context: nextContext, webSearch: nextSearch },
      });
    else {
      setContext(nextContext);
      setSearch(nextSearch);
    }
  }
  const act = (action: string, body?: unknown) =>
    mutation.mutate({ action, body });
  const error = uploads.error || mutation.error?.message;
  const title = chat?.title || (id ? "" : "New conversation");
  const providerLabel = chat?.provider
    ? `${PROVIDER_LABELS[chat.provider as ProviderId] ?? chat.provider}${chat.model ? ` · ${chat.model}` : ""}`
    : "";
  const subtitle = busy
    ? phaseLabel(chat?.phase)
    : chat?.status === "approval"
      ? "Waiting for your decision"
      : providerLabel || (compact ? "Chat in context" : "Timely assistant");
  const hint = uploads.images.length
    ? "One receipt per message · up to 5 photos · images removed after confirmation or 24 hours"
    : chat?.sensitive
      ? "Image-based changes always need your review."
      : "Simple changes happen directly. Larger changes are yours to review.";
  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 flex-col bg-background",
        dragging && "ring-2 ring-inset ring-primary/50",
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          if (!busy && !mutation.isPending)
            void uploads.add(Array.from(e.dataTransfer.files));
        }
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-primary/60 bg-card px-4 py-3 text-sm font-medium text-primary shadow-lg">
            <ImagePlus className="size-4" />
            Drop JPEG or PNG photos to attach
          </div>
        </div>
      )}
      <header
        className={cn(
          "flex shrink-0 items-center gap-2.5 border-b border-border px-4 md:px-5",
          compact ? "h-13" : "h-14",
        )}
      >
        {onToggleHistory && !historyOpen && (
          <button
            type="button"
            aria-label="Show history"
            onClick={onToggleHistory}
            className={cn(iconButton, "-ml-1")}
          >
            <PanelLeftOpen className="size-4" />
          </button>
        )}
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {title || <span className="text-muted-foreground">Loading…</span>}
            </h1>
            {chat && chat.status !== "idle" && (
              <StatusPill status={chat.status} phase={chat.phase} />
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {onNew && (
          <button
            type="button"
            onClick={onNew}
            title="New chat"
            aria-label="New chat"
            className={iconButton}
          >
            <Plus className="size-4" />
          </button>
        )}
        {onOpenFull && (
          <button
            type="button"
            aria-label="Open in Chat tab"
            title="Open in Chat tab"
            onClick={onOpenFull}
            className={iconButton}
          >
            <ArrowUpRight className="size-4" />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            aria-label="Close chat"
            onClick={onClose}
            className={iconButton}
          >
            <X className="size-4" />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 md:px-8">
        <div className={cn("mx-auto w-full max-w-3xl py-6", compact && "py-4")}>
          {query.isLoading && id && (
            <div
              role="status"
              className="space-y-4 py-2"
              aria-label="Loading conversation"
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={cn("flex gap-3", i === 1 && "justify-end")}
                >
                  {i !== 1 && (
                    <div className="size-7 animate-pulse rounded-lg bg-muted" />
                  )}
                  <div
                    className={cn(
                      "h-12 animate-pulse rounded-2xl bg-muted",
                      i === 1 ? "w-1/2" : "w-3/4",
                    )}
                  />
                </div>
              ))}
            </div>
          )}
          {query.error && id && (
            <LoadError
              what="this conversation"
              error={query.error}
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
            />
          )}
          {!id && (
            <EmptyHero
              compact={compact}
              onPick={(text) => {
                setDraft(text);
                input.current?.focus();
              }}
            />
          )}
          {chat && <MessageList chat={chat} />}
          <div ref={receiptAnchor} />
          {chat?.imageReview?.status === "review" &&
            chat.imageReview.receipt && (
              <ReceiptReview
                key={`${chat.imageReview.receiptId}:${JSON.stringify(chat.imageReview.receipt)}:${JSON.stringify(chat.imageReview.destination)}`}
                chat={chat}
                pending={mutation.isPending}
                onDirty={() => setReceiptDirty(true)}
                act={act}
              />
            )}
          {chat?.imageReview?.status === "review" &&
            !chat.imageReview.receipt && (
              <section
                aria-label="Image review"
                className="mt-5 rounded-xl border border-border bg-card p-4"
              >
                <p className="text-sm font-medium">Keep the extracted text?</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Images stay available during review, for up to 24 hours.
                  Confirm to remove them and keep the extracted text.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy || mutation.isPending}
                    onClick={() =>
                      act("/images/confirm", { revision: chat.revision })
                    }
                    className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    Confirm image review
                  </button>
                  <button
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() => act("/images/discard")}
                    className="rounded-lg border border-border bg-card px-3.5 py-2 text-sm hover:border-primary/30 disabled:opacity-50"
                  >
                    Discard images
                  </button>
                </div>
              </section>
            )}
          {!!chat?.plan?.length && (
            <ProposalPanel
              chat={chat}
              pending={mutation.isPending}
              receiptDirty={receiptDirty}
              act={act}
            />
          )}
          {busy && chat?.phase !== "apply" && (
            <div
              role="status"
              className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-sm"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <TimelyLogo size={16} animated duration={SPINNER_LOOP_SECONDS} tone="mono" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{phaseLabel(chat?.phase)}</p>
                <p className="text-xs text-muted-foreground">
                  This keeps running on the server. You can leave and come back.
                </p>
              </div>
            </div>
          )}
          {chat?.error && !chat.plan?.length && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
            >
              <p className="font-medium text-destructive">
                Something went wrong
              </p>
              <p className="mt-1 text-sm leading-6">{chat.error}</p>
              {["failed", "stopped"].includes(chat.status) && (
                <button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => act("/retry")}
                  className="mt-3 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium hover:border-primary/30 disabled:opacity-50"
                >
                  Try again
                </button>
              )}
            </div>
          )}
          {chat?.error && !!chat.plan?.length && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {chat.error}
            </p>
          )}
          <div ref={bottom} />
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mx-auto w-full max-w-3xl px-4 text-sm text-destructive md:px-8"
        >
          {error}
        </p>
      )}
      <Composer
        inputRef={input}
        draft={draft}
        setDraft={setDraft}
        placeholder={
          chat?.status === "approval"
            ? "Tell me what to change…"
            : "Ask Timely to create, plan, or update…"
        }
        chips={chips}
        onRemoveChip={(i) =>
          configure(
            chips.filter((_, j) => j !== i),
            webSearch,
          )
        }
        images={uploads.images}
        uploading={uploads.uploading}
        addFiles={(files) => void uploads.add(files)}
        removeImage={(imageId) => void uploads.remove(imageId)}
        webSearch={webSearch}
        sensitive={!!chat?.sensitive}
        onToggleSearch={() => configure(chips, !webSearch)}
        busy={busy}
        pending={mutation.isPending}
        onSend={send}
        onStop={() => act("/stop")}
        hint={hint}
      />
    </div>
  );
}
