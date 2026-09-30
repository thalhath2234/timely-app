"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ImagePlus,
  Check,
  Globe2,
  LoaderCircle,
  MessageCircle,
  Plus,
  Sparkles,
  Square,
  Table2,
  CalendarDays,
  FolderKanban,
  X,
} from "lucide-react";
import { chatRequest, type Chat, type ChatContext } from "@/app/utils/api/chat";
import { chatKey, chatsKey, useChat } from "@/app/utils/hooks/chat";
import { cn } from "@/app/utils/cn";
import ChatText from "./chatText";
import ChangeCards from "./changeCards";
import ReceiptReview, { ReceiptSummary } from "./receiptReview";
import {
  ImagePreview,
  PendingImages,
  useImageUploads,
} from "./imageAttachments";

const suggestions = [
  {
    icon: FolderKanban,
    title: "Start a project",
    text: "Create a project for a PDF tool and a document with an initial plan.",
  },
  {
    icon: Table2,
    title: "Build a budget",
    text: "Create a project budget sheet with Item, Quantity, Unit price, and Total columns.",
  },
  {
    icon: CalendarDays,
    title: "Make room to learn",
    text: "Create a workspace for learning Japanese and add three study sessions.",
  },
];
export default function Conversation({
  id,
  initialContext = [],
  onCreated,
  onNew,
  compact = false,
}: {
  id?: string | null;
  initialContext?: ChatContext[];
  onCreated: (id: string) => void;
  onNew?: () => void;
  compact?: boolean;
}) {
  const query = useChat(id);
  const cache = useQueryClient();
  const chat = query.data;
  const [draft, setDraft] = useState("");
  const [receiptDirty, setReceiptDirty] = useState(false);
  const uploads = useImageUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const [context, setContext] = useState(initialContext);
  const [search, setSearch] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const receiptAnchor = useRef<HTMLDivElement>(null);
  const lastRevision = useRef<number | null>(null);
  const busy = !!chat && ["queued", "running"].includes(chat.status);
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
        `/${id}${action}`,
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
    if (chat.unread && document.hasFocus())
      void chatRequest(`/${chat.id}/read`, "POST").then(() =>
        cache.invalidateQueries({ queryKey: chatsKey }),
      );
    if (
      lastRevision.current !== null &&
      lastRevision.current !== chat.revision &&
      chat.plan?.some((s) => s.status === "done")
    ) {
      for (const key of [
        "tasks",
        "projects",
        "docs",
        "sheets",
        "workspaces",
        "calendar",
        "today",
        "notifications",
      ])
        void cache.invalidateQueries({ queryKey: [key] });
    }
    lastRevision.current = chat.revision;
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
  const error =
    uploads.error || mutation.error?.message || query.error?.message;
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          if (!busy && !mutation.isPending)
            void uploads.add(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 px-5 md:px-7">
        <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            {chat?.title || "New conversation"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {busy ? "Working on your request" : "Timely assistant"}
          </p>
        </div>
        {onNew && (
          <button
            type="button"
            onClick={onNew}
            title="New chat"
            aria-label="New chat"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-4" />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 md:px-8">
        <div className={cn("mx-auto w-full max-w-3xl py-8", compact && "py-5")}>
          {query.isLoading && id ? (
            <div
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              Loading conversation…
            </div>
          ) : null}
          {!id && (
            <div className={cn("mx-auto max-w-2xl py-10", compact && "py-2")}>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                <Sparkles className="size-3.5" />A little less busywork
              </div>
              <h2
                className={cn(
                  "text-4xl font-semibold tracking-tight",
                  compact && "text-3xl",
                )}
              >
                What would you like
                <br />
                to make happen?
              </h2>
              <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">
                Turn an idea into a project, shape a sheet, or make a plan for
                your week. We’ll work through it together.
              </p>
              <div
                className={cn(
                  "mt-8 grid gap-3 sm:grid-cols-3",
                  compact && "mt-5",
                )}
              >
                {suggestions.map(({ icon: Icon, title, text }) => (
                  <button
                    key={title}
                    type="button"
                    onClick={() => {
                      setDraft(text);
                      input.current?.focus();
                    }}
                    className="group rounded-xl border border-border p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    <Icon className="mb-3 size-5 text-primary" />
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div
            className="space-y-7"
            role="log"
            aria-live="polite"
            aria-label="Conversation messages"
          >
            {chat?.messages?.map((m) => (
              <div
                key={m.id}
                className={cn(
                  m.role === "user" &&
                    "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-muted px-5 py-3",
                )}
              >
                {m.role !== "user" && (
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Sparkles className="size-3.5 text-primary" />
                    Timely
                  </div>
                )}
                <ChatText text={m.content} />
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
                {m.steps && (
                  <div className="mt-3">
                    <ChangeCards steps={m.steps} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div ref={receiptAnchor} />
          {chat?.imageReview?.status === "review" &&
            chat.imageReview.receipt && (
              <ReceiptReview
                key={`${chat.imageReview.receiptId}:${JSON.stringify(chat.imageReview.receipt)}:${JSON.stringify(chat.imageReview.destination)}`}
                chat={chat}
                pending={mutation.isPending}
                onDirty={() => setReceiptDirty(true)}
                act={(action, body) => mutation.mutate({ action, body })}
              />
            )}
          {chat?.imageReview?.status === "review" &&
            !chat.imageReview.receipt && (
              <section
                aria-label="Image review"
                className="mt-5 rounded-xl border border-border p-4"
              >
                <p className="text-xs leading-5 text-muted-foreground">
                  Images stay available during review, for up to 24 hours.
                  Confirm to remove them and keep the extracted text.
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    disabled={busy || mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        action: "/images/confirm",
                        body: { revision: chat.revision },
                      })
                    }
                    className="rounded-full bg-primary px-4 py-2 text-xs text-primary-foreground"
                  >
                    Confirm image review
                  </button>
                  <button
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({ action: "/images/discard" })
                    }
                    className="rounded-full border border-border px-4 py-2 text-xs"
                  >
                    Discard images
                  </button>
                </div>
              </section>
            )}
          {!!chat?.plan?.length && (
            <section
              className="mt-7 rounded-2xl bg-muted/35 p-4"
              aria-label="Proposed changes"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {chat.status === "approval"
                    ? "Ready for your review"
                    : "Your changes"}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {chat.plan.filter((s) => s.status === "done").length} /{" "}
                  {chat.plan.length} complete
                </span>
              </div>
              <ChangeCards steps={chat.plan} />
              {chat.status === "approval" && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                    {receiptDirty
                      ? "Receipt fields changed. Select Review sheet changes before applying."
                      : chat.imageReview?.status === "review"
                        ? "Apply saves these changes and removes the temporary images."
                        : "Review the details, or tell me what to change below."}
                  </p>
                  <button
                    type="button"
                    disabled={mutation.isPending || receiptDirty}
                    onClick={() =>
                      mutation.mutate({
                        action: "/approve",
                        body: { revision: chat.revision },
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    <Check className="size-4" />
                    Apply changes
                  </button>
                </div>
              )}
            </section>
          )}
          {busy && (
            <div
              role="status"
              className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              {chat?.phase === "apply"
                ? "Saving your changes…"
                : chat?.phase === "extract"
                  ? "Reading your images…"
                  : chat?.phase === "receipt_edit"
                    ? "Revising your receipt…"
                    : "Thinking it through…"}
              <span className="ml-auto text-xs">You can leave this chat.</span>
            </div>
          )}
          {chat?.error && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
            >
              {chat.error}
            </div>
          )}
          {chat && ["failed", "stopped"].includes(chat.status) && (
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ action: "/retry" })}
              className="mt-3 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              {chat.phase === "apply"
                ? "Review unfinished changes"
                : "Try again"}
            </button>
          )}
          <div ref={bottom} />
        </div>
      </div>
      <div className="shrink-0 px-4 pb-4 pt-2 md:px-8 md:pb-6">
        <div className="mx-auto max-w-3xl">
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="rounded-2xl border border-border bg-muted/20 p-3 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
            {!!chips.length && (
              <div className="mb-2 flex flex-wrap gap-2">
                {chips.map((chip, i) => (
                  <span
                    key={`${chip.kind}-${i}`}
                    title={chip.value}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-primary/8 py-1 pl-2.5 text-xs text-primary"
                  >
                    <MessageCircle className="size-3 shrink-0" />
                    <span className="truncate">{chip.label}</span>
                    <button
                      type="button"
                      disabled={busy || mutation.isPending}
                      aria-label={`Remove ${chip.label} context`}
                      onClick={() =>
                        configure(
                          chips.filter((_, j) => j !== i),
                          webSearch,
                        )
                      }
                      className="p-1.5 hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <PendingImages
              images={uploads.images}
              remove={(id) => void uploads.remove(id)}
            />
            {uploads.uploading && (
              <p
                role="status"
                className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"
              >
                <LoaderCircle className="size-3 animate-spin" />
                Uploading image…
              </p>
            )}
            <textarea
              ref={input}
              aria-label="Message Timely"
              placeholder={
                chat?.status === "approval"
                  ? "Tell me what to change…"
                  : "Ask Timely to create, plan, or update…"
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  if (!busy && !mutation.isPending) void uploads.add(files);
                }
              }}
              maxLength={16000}
              rows={2}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
              className="max-h-44 min-h-16 w-full resize-y bg-transparent px-1 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  className="hidden"
                  aria-label="Upload images"
                  onChange={(e) => {
                    if (e.target.files)
                      void uploads.add(Array.from(e.target.files));
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  aria-label="Attach images"
                  title="Attach up to five JPEG or PNG photos"
                  disabled={busy || mutation.isPending || uploads.uploading}
                  onClick={() => fileInput.current?.click()}
                  className="rounded-full p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  <ImagePlus className="size-4" />
                </button>
                <button
                  type="button"
                  aria-pressed={
                    webSearch && !chat?.sensitive && !uploads.images.length
                  }
                  disabled={
                    busy ||
                    mutation.isPending ||
                    chat?.sensitive ||
                    !!uploads.images.length
                  }
                  onClick={() => configure(chips, !webSearch)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs transition-colors disabled:opacity-50",
                    webSearch
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Globe2 className="size-4" />
                  {chat?.sensitive || uploads.images.length
                    ? "Private image chat"
                    : "Web search"}
                  {webSearch && !chat?.sensitive && !uploads.images.length && (
                    <Check className="size-3" />
                  )}
                </button>
              </div>
              {busy ? (
                <button
                  type="button"
                  aria-label="Stop run"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ action: "/stop" })}
                  className="flex size-10 items-center justify-center rounded-full border border-border bg-background hover:bg-muted"
                >
                  <Square className="size-4 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Send message"
                  disabled={
                    (!draft.trim() && !uploads.images.length) ||
                    mutation.isPending ||
                    uploads.uploading
                  }
                  onClick={send}
                  className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  {mutation.isPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ArrowUp className="size-5" />
                  )}
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            {uploads.images.length
              ? "One receipt per message · up to 5 photos · images removed after confirmation or 24 hours"
              : chat?.sensitive
                ? "Image-based changes always need your review."
                : "Simple changes happen directly. Larger changes are yours to review."}
          </p>
        </div>
      </div>
    </div>
  );
}
