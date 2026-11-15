"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ExternalLink, MessageCircle, Undo2 } from "lucide-react";
import { changedLine } from "@timely/contract/bots";
import {
  hostWaiting,
  type HostChoice,
  type HostRequest,
} from "@timely/contract/agentChat";
import Button from "@/app/_components/_ui/button";
import {
  GroupLabel,
  ListGroup,
  ListRow,
} from "@/app/_components/_ui/groupedList";
import { SkeletonCards } from "@/app/_components/_ui/skeleton";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import HostCard from "@/app/_components/chat/hostCard";
import {
  answerDevice,
  hostAnswerBody,
  hostAnswerError,
  hostAnswerStale,
  type Surface,
} from "@/app/_components/chat/hostView";
import { useToastStore } from "@/app/_store/toastStore";
import { cn } from "@/app/utils/cn";
import {
  answerHostCard,
  type BotThreadLine,
  type BotThreadView,
} from "@/app/utils/api/chat";
import {
  botThreadKey,
  useBotThread,
  useChatSettings,
  useCreateBotFromDraft,
  useDoAlertInChat,
  useResolveBotPending,
  useReviewBotAlert,
  useSendBotThread,
  useUndoBotChange,
} from "@/app/utils/hooks/chat";
import { useDesktopShell } from "@/app/utils/hooks/desktop";
import { scheduleWords, pendingTitle } from "./agentBot";

const say = (message: string) => useToastStore.getState().show(message);

/** A line of the thread in time order: the person's own messages and the Bot's lines. */
type Entry =
  | { kind: "user"; id: string; at: string; text: string }
  | { kind: "line"; id: string; at: string; line: BotThreadLine };

function entriesOf(view: BotThreadView): Entry[] {
  const users: Entry[] = view.thread.messages
    .filter((m) => m.role === "user" && m.content)
    .map((m) => ({
      kind: "user",
      id: m.id,
      at: m.createdAt,
      text: m.content,
    }));
  const lines: Entry[] = view.items.map((line) => ({
    kind: "line",
    id: line.id,
    at: line.at,
    line,
  }));
  return [...users, ...lines].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
}

function Card({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "warn";
  className?: string;
}) {
  return (
    <section
      className={cn(
        "max-w-full overflow-hidden rounded-xl border bg-card sm:max-w-[86%]",
        tone === "warn" ? "border-warning/50" : "border-border",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** The Bot's side of the thread: the mark, then what it says. */
function BotSide({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-foreground">
        <TimelyLogo size={16} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** "Changed: X -> Y", with Undo. */
function ChangeCard({ id, line }: { id: string; line: BotThreadLine }) {
  const undo = useUndoBotChange();
  const undone = !!line.undone || undo.isSuccess;
  return (
    <Card>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <p
          className={cn(
            "min-w-0 flex-1 break-words text-[13px] font-medium text-foreground",
            undone && "text-muted-foreground line-through",
          )}
        >
          {changedLine(line.before ?? "", line.after ?? "")}
        </p>
        {undone ? (
          <span className="text-xs text-muted-foreground">Undone</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            leading={<Undo2 />}
            loading={undo.isPending}
            disabled={!line.undoToken}
            onClick={() =>
              undo.mutate(
                { id, undoToken: line.undoToken ?? "" },
                { onError: (error) => say(error.message) },
              )
            }
          >
            Undo
          </Button>
        )}
      </div>
    </Card>
  );
}

/** A change that gives the Bot more reach waits here for one tap. */
function PendingCard({ id, line }: { id: string; line: BotThreadLine }) {
  const resolve = useResolveBotPending();
  const open = (line.state ?? "pending") === "pending";
  const act = (action: "approve" | "discard") =>
    resolve.mutate(
      { id, itemId: line.id, action },
      { onError: (error) => say(error.message) },
    );
  return (
    <Card tone={open ? "warn" : "default"}>
      <div className="px-3.5 py-2.5">
        <p className="text-[13px] font-semibold text-foreground">
          {pendingTitle(line.reason)}
        </p>
        <p className="mt-0.5 break-words text-[13px] text-muted-foreground">
          {changedLine(line.before ?? "", line.after ?? "")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          This gives it more reach, so it waits for your OK.
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3.5 py-2">
        {open ? (
          <>
            <Button
              size="sm"
              loading={
                resolve.isPending && resolve.variables?.action === "approve"
              }
              disabled={resolve.isPending}
              onClick={() => act("approve")}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={
                resolve.isPending && resolve.variables?.action === "discard"
              }
              disabled={resolve.isPending}
              onClick={() => act("discard")}
            >
              Not now
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {line.state === "approved" ? "Approved" : "Not now"}
          </span>
        )}
      </div>
    </Card>
  );
}

/** The Review card of an alert's proposed Timely write: nothing applies until Approve. */
function ReviewCard({
  alertId,
  line,
}: {
  alertId: string;
  line: BotThreadLine;
}) {
  const review = useReviewBotAlert();
  const card = line.review;
  if (!card) return null;
  const open = card.state === "pending";
  return (
    <div
      className="mt-2.5 overflow-hidden rounded-[10px] border border-border bg-background"
      data-testid="bot-review-card"
    >
      <div className="px-3 py-2">
        <p className="text-xs font-semibold text-foreground">
          Review before it changes anything
        </p>
        {card.summary ? (
          <p className="mt-0.5 text-[13px] text-foreground">{card.summary}</p>
        ) : null}
        {card.steps.length ? (
          <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
            {card.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
        {open ? (
          <>
            <Button
              size="sm"
              loading={
                review.isPending && review.variables?.action === "approve"
              }
              disabled={review.isPending}
              onClick={() =>
                review.mutate(
                  { alertId, action: "approve" },
                  { onError: (error) => say(error.message) },
                )
              }
            >
              Approve
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={
                review.isPending && review.variables?.action === "discard"
              }
              disabled={review.isPending}
              onClick={() =>
                review.mutate(
                  { alertId, action: "discard" },
                  { onError: (error) => say(error.message) },
                )
              }
            >
              Discard
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {card.state === "applied" || card.state === "approved"
              ? "Approved and applied"
              : card.state === "discarded"
                ? "Discarded"
                : card.state}
          </span>
        )}
      </div>
    </div>
  );
}

/** An alert the Bot sent, with Do this in chat and, when it proposed a write, its Review card. */
function AlertCard({
  line,
  onOpenChat,
}: {
  line: BotThreadLine;
  onOpenChat?: (conversationId: string) => void;
}) {
  const doChat = useDoAlertInChat();
  const alertId = line.alertId ?? "";
  return (
    <Card>
      <div className="px-3.5 py-3">
        <p className="break-words text-sm font-semibold text-foreground">
          {line.title}
        </p>
        {line.body ? (
          <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
            {line.body}
          </p>
        ) : null}
        {line.url ? (
          <a
            href={line.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="size-3" />
            <span className="truncate">{line.url}</span>
          </a>
        ) : null}
        <ReviewCard alertId={alertId} line={line} />
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3.5 py-2">
        <Button
          variant="outline"
          size="sm"
          leading={<MessageCircle />}
          loading={doChat.isPending}
          disabled={!alertId}
          onClick={() =>
            doChat.mutate(
              { alertId },
              {
                onSuccess: (res) => onOpenChat?.(res.conversationId),
                onError: (error) => say(error.message),
              },
            )
          }
        >
          Do this in chat
        </Button>
      </div>
    </Card>
  );
}

/** A new Bot's whole setup, shown for one Create. */
function SetupCard({
  line,
  creating,
  error,
  onCreate,
}: {
  line: BotThreadLine;
  creating: boolean;
  error?: string;
  onCreate: () => void;
}) {
  const f = line.fields;
  const rows: [string, string][] = f
    ? [
        ["What to do", f.prompt || "Not set yet"],
        ["Schedule", scheduleWords(f.schedule)],
        ["Only when changed", f.gate === "changed" ? "Yes" : "No"],
        ["Only during market hours", f.marketHours ? "Yes" : "No"],
        ["Skills", f.skills.length ? f.skills.join(", ") : "None"],
        [
          "Signed-in sites",
          f.tools.browserSites.length
            ? f.tools.browserSites.join(", ")
            : "None",
        ],
        [
          "Extra hosts",
          f.tools.egress.length ? f.tools.egress.join(", ") : "None",
        ],
        ["Memory and About you", f.tools.useMemory ? "On" : "Off"],
        [
          "Permission",
          f.permission === "full"
            ? "Full Access"
            : f.permission === "supervised"
              ? "Supervised"
              : "Auto",
        ],
        ["Model", f.model || "Your default"],
      ]
    : [];
  return (
    <section className="max-w-full" data-testid="bot-draft-setup">
      <GroupLabel>{line.name || "New bot"}</GroupLabel>
      <ListGroup>
        {rows.map(([label, value]) => (
          <ListRow key={label} label={label} meta={value} wrapMeta />
        ))}
      </ListGroup>
      <div className="mt-3 flex items-center gap-3">
        <Button loading={creating} onClick={onCreate}>
          Create bot
        </Button>
        <p
          className={cn(
            "min-w-0 flex-1 text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ?? "Keep talking to change anything first."}
        </p>
      </div>
    </section>
  );
}

function Composer({
  placeholder,
  busy,
  onSend,
}: {
  placeholder: string;
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText("");
  };
  return (
    <div className="shrink-0 border-t border-border bg-card px-4 py-3">
      <div className="flex items-end gap-2 rounded-[12px] border border-border bg-background p-1.5 focus-within:border-ring/50">
        <textarea
          aria-label="Message the Bot"
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="max-h-40 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-5 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        <Button
          icon
          size="sm"
          aria-label="Send"
          disabled={!text.trim() || busy}
          onClick={send}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}

/**
 * A Bot's thread: its alerts, the changes you asked for ("Changed: X -> Y",
 * with Undo), changes waiting for one tap, steps parked in Needs you, and a
 * box to change the Bot by talking to it. A new Bot starts as its thread,
 * with its whole setup shown for one Create.
 */
export function BotThread({
  id,
  onCreated,
  onOpenChat,
  className,
}: {
  /** A Bot's id (its thread is made when it has none) or a draft thread's id. */
  id: string;
  /** A draft thread's Create made this Bot. */
  onCreated?: (botId: string) => void;
  /** "Do this in chat" made this chat. */
  onOpenChat?: (conversationId: string) => void;
  className?: string;
}) {
  const query = useBotThread(id);
  const view = query.data;
  const send = useSendBotThread();
  const create = useCreateBotFromDraft();
  const cache = useQueryClient();
  const surface: Surface = useDesktopShell() ? "desktop" : "web";
  const settings = useChatSettings().data;
  const end = useRef<HTMLDivElement>(null);
  const threadId = view?.thread.id ?? "";
  const entries = useMemo(() => (view ? entriesOf(view) : []), [view]);
  const working =
    view?.thread.status === "queued" || view?.thread.status === "running";
  const host = view?.thread;
  const parked: HostRequest | undefined =
    host && hostWaiting(host) ? host.hostRequest : undefined;

  // The newest line comes into view.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [entries.length, working, parked?.requestId]);

  const hostAnswer = useMutation({
    mutationFn: (input: { request: HostRequest; choice: HostChoice }) =>
      answerHostCard(
        threadId,
        hostAnswerBody(
          input.request,
          view?.thread.revision ?? 0,
          input.choice,
          answerDevice(surface, surface === "web" ? "Web browser" : "", false),
        ),
      ),
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: botThreadKey(id) });
      void cache.invalidateQueries({ queryKey: ["chats"] });
    },
  });

  if (query.isLoading) return <SkeletonCards className="m-4" />;
  if (!view)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {query.error?.message ?? "This thread isn't available."}
      </p>
    );

  const draft = !!view.summary.draft;
  const placeholder = draft
    ? "Describe the Bot you want, or change its setup"
    : "Tell it what to change, or ask what it has done";

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        role="log"
        aria-label="Bot thread"
      >
        <div className="flex flex-col gap-4">
          {entries.length === 0 && !parked ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {draft
                ? "Say what the Bot should do. Its whole setup shows here, ready for one Create."
                : "Alerts and the changes you ask for show up here."}
            </p>
          ) : null}
          {entries.map((entry) =>
            entry.kind === "user" ? (
              <div key={entry.id} className="flex justify-end">
                <p className="max-w-[86%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                  {entry.text}
                </p>
              </div>
            ) : (
              <BotSide key={entry.id}>
                {entry.line.kind === "answer" ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {entry.line.text}
                  </p>
                ) : entry.line.kind === "change" ? (
                  <ChangeCard id={threadId} line={entry.line} />
                ) : entry.line.kind === "pending_change" ? (
                  <PendingCard id={threadId} line={entry.line} />
                ) : entry.line.kind === "alert" ? (
                  <AlertCard line={entry.line} onOpenChat={onOpenChat} />
                ) : (
                  <SetupCard
                    line={entry.line}
                    creating={create.isPending}
                    error={create.error?.message}
                    onCreate={() =>
                      create.mutate(threadId, {
                        onSuccess: (res) => {
                          say("Your bot is set up");
                          onCreated?.(res.botId);
                        },
                      })
                    }
                  />
                )}
              </BotSide>
            ),
          )}
          {parked?.requestId ? (
            <BotSide>
              <HostCard
                key={parked.requestId}
                request={parked}
                surface={surface}
                rule={settings?.hostApprovalRule}
                sending={
                  hostAnswer.isPending
                    ? (hostAnswer.variables?.choice ?? null)
                    : null
                }
                error={
                  hostAnswer.error
                    ? hostAnswerError(
                        (hostAnswer.error as { status?: number }).status,
                        hostAnswer.error.message,
                      )
                    : undefined
                }
                onAnswer={(choice) =>
                  hostAnswer.mutate(
                    { request: parked, choice },
                    {
                      onError: (error) => {
                        if (
                          hostAnswerStale((error as { status?: number }).status)
                        )
                          void query.refetch();
                      },
                    },
                  )
                }
              />
            </BotSide>
          ) : null}
          {working ? (
            <BotSide>
              <p className="text-sm text-muted-foreground">Working…</p>
            </BotSide>
          ) : null}
          {view.thread.error ? (
            <p className="text-xs text-destructive">{view.thread.error}</p>
          ) : null}
          <div ref={end} />
        </div>
      </div>
      <Composer
        placeholder={placeholder}
        busy={send.isPending || working}
        onSend={(text) =>
          send.mutate(
            { id: threadId, content: text },
            { onError: (error) => say(error.message) },
          )
        }
      />
    </div>
  );
}
