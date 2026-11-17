import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { hostNeedsUnlock, type HostChoice, type HostRequest } from "@timely/contract/agentChat";
import { Send, SlidersHorizontal } from "lucide-react-native";
import BottomSheet from "../ui/BottomSheet";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Field } from "../ui/primitives";
import { SkeletonRows } from "../ui/motionKit";
import {
  answerHostCard,
  createBotFromDraft,
  doAlertInChat,
  resolveBotChange,
  reviewBotAlert,
  sendThreadMessage,
  startBotDraft,
  undoBotChange,
  type BotThreadLine,
} from "../../lib/api/chat";
import { ApiError } from "../../lib/api/client";
import { unlockDevice, withUnlock } from "../../lib/deviceUnlock";
import { answerDevice, hostAnswerBody, hostAnswerError, hostAnswerStale } from "../../lib/chat/host";
import { useAgentChatSettingsQuery } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { useAssistant } from "../chat/AssistantProvider";
import HostCard from "../chat/HostCard";
import { AlertCard, AnswerBubble, ChangeCard, DraftSetupCard, PendingCard, UserBubble } from "./ThreadCards";
import { draftSetup, parkedStep, threadIsEmpty, threadRows } from "./threadRows";
import { threadWorking, useBotThread, useRefreshAssistant } from "./useAssistantData";

const say = (message: string) => useToastStore.getState().show(message);

/** The phone's unlock was cancelled or failed: nothing was sent. */
class UnlockRefused extends Error {}

/** The device name an answer records. */
const phoneName = () => (Platform.OS === "ios" ? "iPhone" : Platform.OS === "android" ? "Android phone" : "Phone browser");
const nextId = () => `thr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * A Bot's own thread: the person changes the Bot by talking to it. A change
 * is made at once and answered with "Changed: X -> Y" and Undo; one that gives
 * the Bot more reach waits for one tap. The thread answers from the Bot's own
 * history and makes no other change. Alerts are posted here with Do this in
 * chat and, when a run proposed a Timely write, a Review card.
 *
 * `id` is a Bot's id, or the id of a new Bot's draft thread (it starts as one,
 * with its whole setup shown for one Create). The composer sits in the sheet's
 * footer, which docks above the keyboard.
 */
export function BotThread({
  id,
  title,
  onClose,
  onCreated,
  onEdit,
  firstMessage,
}: {
  id: string | null;
  /** For a new Bot (no id): the request to send as soon as the thread opens (a Starter's). */
  firstMessage?: string;
  /** Shown while the thread loads; the thread's own title replaces it. */
  title?: string;
  onClose: () => void;
  /** A draft was created as this Bot. */
  onCreated: (botId: string) => void;
  /** Opens the grouped-row editor for the Bot (not offered for a draft). */
  onEdit?: () => void;
}) {
  const assistant = useAssistant();
  const refresh = useRefreshAssistant();
  // A new Bot begins with no thread; the first message makes its draft.
  const [startedId, setStartedId] = useState<string | null>(null);
  const thread = useBotThread(id ?? startedId);
  const view = thread.data;
  const [text, setText] = useState("");
  const [sending, setSending] = useState<string | undefined>();
  const threadId = view?.thread.id ?? startedId ?? id;
  const draft = !!view?.summary.draft || (!id && !!startedId);
  const requestId = useRef(nextId());

  const send = useMutation({
    mutationFn: async (content: string) => {
      if (!id && !startedId) {
        const started = await startBotDraft(content);
        setStartedId(started.thread.id);
        return started;
      }
      return sendThreadMessage(threadId as string, content, requestId.current);
    },
    onMutate: (content) => setSending(content),
    onSuccess: () => {
      requestId.current = nextId();
      setText("");
      refresh(threadId ?? undefined);
    },
    onError: (error: Error) => say(error.message),
    onSettled: () => setSending(undefined),
  });

  const act = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => refresh(threadId ?? undefined),
    onError: (error: Error) => say(error.message),
  });
  const create = useMutation({
    mutationFn: () => createBotFromDraft(threadId as string),
    onSuccess: (done) => {
      refresh();
      say("Created. It starts running on its schedule.");
      onCreated(done.botId);
    },
    onError: (error: Error) => say(error.message),
  });
  // A step the Bot's run parked in Needs you: Run once or Deny, answered through the
  // host-card call. Run once unlocks the phone first; Deny never asks.
  const parked = parkedStep(view?.thread);
  const settings = useAgentChatSettingsQuery(!!parked);
  const [hostNote, setHostNote] = useState("");
  const [hostUnlocking, setHostUnlocking] = useState(false);
  const hostAnswer = useMutation({
    mutationFn: async (input: { request: HostRequest; choice: HostChoice }) => {
      const sent = await withUnlock(
        hostNeedsUnlock(input.choice, "phone"),
        (unlocked) =>
          answerHostCard(
            threadId as string,
            hostAnswerBody(input.request, view?.thread.revision ?? 0, input.choice, answerDevice("phone", phoneName(), unlocked)),
          ),
        async (prompt) => {
          setHostUnlocking(true);
          try {
            return await unlockDevice(prompt);
          } finally {
            setHostUnlocking(false);
          }
        },
      );
      if (!sent.sent) throw new UnlockRefused(sent.message);
      return sent.value;
    },
    // The thread and the inbox's Needs-you count both move once the step is answered.
    onSuccess: () => {
      setHostNote("");
      refresh(threadId ?? undefined);
    },
    onError: (reason) => {
      if (reason instanceof UnlockRefused) return setHostNote(reason.message);
      // The card closed or changed meanwhile (409): show how it ended.
      if (hostAnswerStale(reason instanceof ApiError ? reason.status : undefined)) refresh(threadId ?? undefined);
    },
  });
  const doInChat = useMutation({
    mutationFn: (alertId: string) => doAlertInChat(alertId, nextId()),
    onSuccess: (done) => {
      refresh();
      onClose();
      assistant.open(done.conversationId);
    },
    onError: (error: Error) => say(error.message),
  });

  // A Starter opens a new Bot's thread with its request already sent.
  const fired = useRef(false);
  useEffect(() => {
    if (id || !firstMessage || fired.current) return;
    fired.current = true;
    send.mutate(firstMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, firstMessage]);

  const rows = useMemo(() => threadRows(view?.thread.messages, view?.items, sending), [view, sending]);
  const setup = draftSetup(view?.items);
  const busy = act.isPending || create.isPending || doInChat.isPending;
  const running = threadWorking(view?.summary);
  const name = view?.summary.title || title || "New Bot";

  const renderLine = (line: BotThreadLine) => {
    switch (line.kind) {
      case "alert":
        return (
          <AlertCard
            item={line}
            busy={busy}
            onDoInChat={() => doInChat.mutate(line.alertId)}
            onReview={(action) => act.mutate(() => reviewBotAlert(line.alertId, action))}
            onOpenReceipt={(conversationId) => {
              onClose();
              assistant.open(conversationId);
            }}
          />
        );
      case "change":
        return <ChangeCard item={line} busy={busy} onUndo={() => act.mutate(() => undoBotChange(threadId as string, line.undoToken))} />;
      case "pending_change":
        return (
          <PendingCard
            item={line}
            busy={busy}
            onResolve={(action) => act.mutate(() => resolveBotChange(threadId as string, line.id, action))}
          />
        );
      case "answer":
        return <AnswerBubble text={line.text} />;
      case "draft_setup":
        // Only the newest setup is shown: it is the one Create makes.
        return line === setup ? <DraftSetupCard item={line} busy={create.isPending} onCreate={() => create.mutate()} /> : null;
    }
  };

  const submit = () => {
    const content = text.trim();
    if (!content || send.isPending) return;
    send.mutate(content);
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={name}
      subtitle={draft ? "New Bot" : "Talk to it to change it"}
      action={
        onEdit && !draft ? (
          <AnimatedPressable accessibilityRole="button" accessibilityLabel="Edit directly" hitSlop={6} onPress={onEdit} style={styles.headerButton}>
            <SlidersHorizontal size={18} color={colors.foreground} />
          </AnimatedPressable>
        ) : undefined
      }
      footer={
        <View style={styles.composer}>
          <View style={{ flex: 1 }}>
            <Field
              value={text}
              onChangeText={setText}
              placeholder={draft || !id ? "What should it do?" : "Change it, or ask what it did"}
              multiline
              autoGrow
              autoCapitalize="sentences"
              accessibilityLabel="Message to the Bot"
              maxLength={4000}
            />
          </View>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!text.trim() || send.isPending}
            onPress={submit}
            style={[styles.send, (!text.trim() || send.isPending) && styles.sendOff]}
          >
            <Send size={20} color={colors.primaryForeground} />
          </AnimatedPressable>
        </View>
      }
    >
      <View style={styles.body}>
        {thread.isPending && (id ?? startedId) ? <SkeletonRows rows={3} height={72} /> : null}
        {thread.error && !view ? <Text style={styles.muted}>Couldn’t load this thread. Close it and try again.</Text> : null}
        {threadIsEmpty(rows.length, parked, thread.isPending && !!(id ?? startedId)) ? (
          <Text style={styles.muted}>
            {draft || !id
              ? "Tell it what to watch or do, and when. It sets the whole Bot up for you to create."
              : "Nothing yet. Say what to change, or ask what it did lately. Its alerts land here."}
          </Text>
        ) : null}
        {rows.map((row) =>
          row.type === "user" ? (
            <UserBubble key={row.key} text={row.text} />
          ) : (
            <View key={row.key}>{renderLine(row.line)}</View>
          ),
        )}
        {parked?.requestId ? (
          <HostCard
            key={parked.requestId}
            request={parked}
            rule={settings.data?.hostApprovalRule}
            sending={hostAnswer.isPending ? (hostAnswer.variables?.choice ?? null) : null}
            note={hostNote}
            unlocking={hostUnlocking}
            error={
              hostAnswer.isError && !(hostAnswer.error instanceof UnlockRefused) && hostAnswer.variables?.request.requestId === parked.requestId
                ? hostAnswerError(hostAnswer.error instanceof ApiError ? hostAnswer.error.status : undefined, hostAnswer.error.message)
                : undefined
            }
            onAnswer={(choice) => hostAnswer.mutate({ request: parked, choice })}
          />
        ) : null}
        {running || send.isPending ? <Text style={styles.muted}>Working on it…</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet(() => ({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  muted: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  send: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  sendOff: { opacity: 0.4 },
  headerButton: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
}));
