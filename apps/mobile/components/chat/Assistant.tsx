import * as Clipboard from "expo-clipboard";
import { PROVIDER_LABELS, type ProviderId } from "../../lib/api/agentProviders";
import { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AlertTriangle,
  ArrowUpRight,
  ClipboardList,
  MessageCircle,
  Plus,
  ReceiptText,
  WifiOff,
} from "lucide-react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FS from "expo-file-system/legacy";
import { useAuth } from "../../lib/auth/AuthProvider";
import {
  chatRequest,
  deleteChat,
  renameChat,
  uploadChatImage,
} from "../../lib/api/chat";
import { isOffline, subscribeOffline } from "../../lib/networkState";
import { mergeContext } from "../../lib/chat/context";
import { removeLocalImage, retainImage } from "../../lib/chat/storage";
import type { Chat, ChatStep, PendingImage } from "../../lib/chat/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { emptyDraft, useAssistant } from "../../lib/chat/runtime";
import { useToastStore } from "../../lib/toast";
import { fileHref, legacyFilePath } from "../../lib/fileRoutes";
import ConfirmSheet from "../ui/ConfirmSheet";
import AssistantHeader from "./AssistantHeader";
import AttachSheet, { type ImageSource } from "./AttachSheet";
import ModelSheet, { modelLabel, type ModelChoice } from "./ModelSheet";
import Composer from "./Composer";
import HistoryPage from "./HistoryPage";
import ProposalPage from "./ProposalPage";
import ReceiptReview from "./ReceiptReview";
import Thread, { FailureCard, RunStatus, StatusCard, Welcome } from "./Thread";
import { isBusy, phaseLabel, sharedTarget } from "./chatMeta";
import { Action, IconButton } from "./shared";
import TimelyLogo from "../ui/TimelyLogo";

type Page = "chat" | "history" | "proposal" | "receipt";

export default function Assistant() {
  const assistant = useAssistant();
  const { user } = useAuth();
  const uid = user!.id;
  const id = assistant.chatId;
  const queryClient = useQueryClient();
  const toast = useToastStore((state) => state.show);
  const [offline, setOfflineState] = useState(isOffline());
  const [page, setPage] = useState<Page>("chat");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [preview, setPreview] = useState<{
    uri: string;
    candidate?: PendingImage;
  }>();
  const [reviewSteps, setReviewSteps] = useState<ChatStep[] | null>(null);
  const scroll = useRef<ScrollView>(null);
  const runningAction = useRef(false);
  const detailKey = ["chat", uid, id];
  const listKey = ["chats", uid];
  useEffect(() => subscribeOffline(setOfflineState), []);
  const query = useQuery({
    staleTime: 0,
    refetchOnMount: "always",
    queryKey: detailKey,
    queryFn: () => chatRequest<Chat>(`/${encodeURIComponent(id ?? "")}`),
    enabled: !!id && assistant.visible && assistant.foreground && !offline,
    initialData: id ? assistant.cache.conversations[id] : undefined,
    refetchInterval: (q) =>
      assistant.foreground && !offline && isBusy(q.state.data?.status)
        ? 1500
        : false,
  });
  const list = useQuery({
    staleTime: 0,
    refetchOnMount: "always",
    queryKey: listKey,
    queryFn: () => chatRequest<Chat[]>(""),
    initialData: assistant.cache.chats,
    enabled: assistant.visible && assistant.foreground && !offline,
    refetchInterval:
      assistant.foreground && !offline && page === "history" ? 5000 : 15000,
  });
  const chat = id ? query.data : undefined;
  const busy = isBusy(chat?.status);
  const cachedDraft = assistant.cache.draft;
  const matchingDraft =
    cachedDraft && (cachedDraft.conversationId ?? null) === id;
  const draft = matchingDraft ? cachedDraft : emptyDraft(chat?.context ?? []);
  const otherDraft = !!(
    cachedDraft &&
    !matchingDraft &&
    (cachedDraft.text || cachedDraft.images.length || cachedDraft.requestId)
  );
  const reviewEdit = id ? assistant.cache.receiptEdits[id] : undefined;
  const receiptDirty =
    !!reviewEdit?.dirty &&
    reviewEdit.signature ===
      JSON.stringify([
        chat?.imageReview?.receipt,
        chat?.imageReview?.destination,
      ]);
  const context = chat?.context ?? draft.context;
  const search = chat?.webSearch ?? draft.webSearch;
  const model: ModelChoice = chat
    ? { provider: chat.chosenProvider ?? "", model: chat.chosenModel ?? "" }
    : { provider: draft.provider ?? "", model: draft.model ?? "" };
  const lastRevision = useRef<number | undefined>(undefined);
  const openedReceipt = useRef("");
  const unreadCount = (list.data ?? []).filter(
    (c) => c.unread && c.id !== id,
  ).length;
  useEffect(() => {
    if (list.data)
      assistant.updateCache((cache) => ({ ...cache, chats: list.data! }));
  }, [list.data]);
  useEffect(() => {
    if (!chat) return;
    assistant.updateCache((cache) => ({
      ...cache,
      conversations: { ...cache.conversations, [chat.id]: chat },
    }));
    if (chat.unread && assistant.visible && assistant.foreground && !offline)
      void chatRequest(`/${encodeURIComponent(chat.id)}/read`, "POST")
        .then(() => {
          queryClient.setQueryData<Chat>(detailKey, (value) =>
            value ? { ...value, unread: false } : value,
          );
          void queryClient.invalidateQueries({ queryKey: listKey });
          void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        })
        .catch(() => undefined);
    if (chat.revision !== lastRevision.current) {
      for (const key of [
        "tasks",
        "task",
        "projects",
        "project",
        "docs",
        "sheets",
        "sheet-templates",
        "workspaces",
        "calendar",
        "event",
        "today",
        "schedule",
        "config",
        "notifications",
        "search",
        "task-activity",
        "project-activity",
      ])
        void queryClient.invalidateQueries({ queryKey: [key] });
      lastRevision.current = chat.revision;
    }
  }, [chat, assistant.foreground, assistant.visible, offline]);
  useEffect(() => {
    setPage("chat");
    setError("");
    setReviewSteps(null);
    lastRevision.current = undefined;
    openedReceipt.current = "";
  }, [id]);
  useEffect(() => {
    const review = chat?.imageReview;
    if (
      !chat ||
      !review?.receipt ||
      review.status !== "review" ||
      chat.status !== "idle"
    )
      return;
    const key = `${chat.id}:${JSON.stringify(review.receipt)}`;
    if (openedReceipt.current === key) return;
    openedReceipt.current = key;
    if (page === "chat") setPage("receipt");
  }, [chat]);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [page]);
  useEffect(() => {
    if (page === "chat") scroll.current?.scrollToEnd({ animated: true });
  }, [chat?.messages?.length, chat?.status]);

  const mutation = useMutation({
    mutationFn: ({
      action,
      body,
      target = id,
    }: {
      action: string;
      body?: unknown;
      target?: string | null;
    }) =>
      chatRequest<Chat>(
        target ? `/${encodeURIComponent(target)}${action}` : "",
        target ? (action === "" ? "PATCH" : "POST") : "POST",
        body,
      ),
    onSuccess: (next, variables) => {
      queryClient.setQueryData(["chat", uid, next.id], next);
      void queryClient.invalidateQueries({ queryKey: listKey });
      if (variables.action === "/messages") {
        assistant.updateCache((cache) => ({
          ...cache,
          draft:
            cache.draft?.requestId ===
            (variables.body as { requestId?: string })?.requestId
              ? null
              : cache.draft,
          conversations: { ...cache.conversations, [next.id]: next },
        }));
        draft.images.forEach((image) => void removeLocalImage(image.uri));
        assistant.acceptSend(variables.target ?? id, next.id);
      }
      if (
        [
          "/receipt",
          "/images/discard",
          "/images/confirm",
          "/approve",
          "/reject",
        ].includes(variables.action)
      )
        assistant.updateCache((cache) => ({
          ...cache,
          receiptEdits: Object.fromEntries(
            Object.entries(cache.receiptEdits).filter(
              ([key]) => key !== next.id,
            ),
          ),
        }));
      if (variables.action === "/receipt") {
        setReviewSteps(null);
        setPage(next.status === "approval" ? "proposal" : "receipt");
      }
      if (variables.action === "/retry" && next.status === "approval") {
        setReviewSteps(null);
        setPage("proposal");
      }
      if (
        [
          "/images/discard",
          "/images/confirm",
          "/approve",
          "/reject",
          "/stop",
        ].includes(variables.action)
      )
        setPage("chat");
      if (variables.action === "/reject")
        toast("Proposal discarded. Nothing was changed.");
      setError("");
    },
    onError: (reason) => {
      setError(reason.message);
      void query.refetch();
    },
  });
  const pending = mutation.isPending || uploading;
  function act(action: string, body?: unknown) {
    if (!pending && !offline) mutation.mutate({ action, body });
  }
  function editText(text: string) {
    if (otherDraft) return;
    assistant.setDraft((current) => ({
      ...(matchingDraft
        ? current
        : { ...emptyDraft(context), conversationId: id ?? undefined }),
      text,
      requestId: undefined,
    }));
  }
  const canConfigure = !busy && !pending && !(offline && !!id);
  function configure(nextContext = context, webSearch = search) {
    if (!canConfigure) {
      if (offline && id)
        setError("Reconnect to change this conversation's context.");
      return;
    }
    if (id) act("", { context: nextContext, webSearch });
    else
      assistant.setDraft((value) => ({
        ...value,
        context: nextContext,
        webSearch,
        requestId: undefined,
      }));
  }
  // A model choice may change during a run; it applies from the next one.
  const canPickModel = !pending && !(offline && !!id);
  function chooseModel(next: ModelChoice) {
    if (!canPickModel) return;
    if (id) act("", next);
    else
      assistant.setDraft((value) => ({
        ...value,
        ...next,
        requestId: undefined,
      }));
  }
  function addScreen() {
    try {
      configure(mergeContext(context, assistant.currentContext()));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  async function send() {
    if (
      runningAction.current ||
      pending ||
      busy ||
      offline ||
      otherDraft ||
      (!draft.text.trim() && !draft.images.length)
    )
      return;
    runningAction.current = true;
    setUploading(true);
    setError("");
    const requestId =
      draft.requestId ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    assistant.setDraft((value) => ({
      ...value,
      requestId,
      conversationId: id ?? undefined,
    }));
    try {
      const imageIds: string[] = [];
      for (const image of draft.images) {
        const metadata =
          image.uploaded &&
          new Date(image.uploaded.expiresAt).getTime() > Date.now()
            ? image.uploaded
            : await uploadChatImage(image);
        imageIds.push(metadata.id);
        assistant.setDraft((value) => ({
          ...value,
          images: value.images.map((item) =>
            item.uri === image.uri ? { ...item, uploaded: metadata } : item,
          ),
        }));
      }
      await mutation.mutateAsync({
        action: "/messages",
        body: {
          content: draft.text.trim(),
          imageIds,
          requestId,
          ...(!id ? { context, webSearch: search, ...model } : {}),
        },
      });
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setUploading(false);
      runningAction.current = false;
    }
  }
  async function addImages(images: PendingImage[]) {
    if (pending || busy || otherDraft) return;
    if (draft.images.length + images.length > 5) {
      setError("Attach up to five JPEG/PNG images per message.");
      return;
    }
    setUploading(true);
    const retained: PendingImage[] = [];
    try {
      for (const image of images) {
        const info = await FS.getInfoAsync(image.uri);
        if (!info.exists || ("size" in info && info.size > 10 * 1024 * 1024))
          throw new Error(
            "Each image must be available and no larger than 10 MB.",
          );
        retained.push({
          ...image,
          uri: await retainImage(uid, image.uri, image.name),
        });
      }
      assistant.setDraft((current) => ({
        ...(matchingDraft
          ? current
          : { ...emptyDraft(context), conversationId: id ?? undefined }),
        images: [...draft.images, ...retained],
        requestId: undefined,
      }));
    } catch (reason) {
      await Promise.allSettled(
        retained.map((image) => removeLocalImage(image.uri)),
      );
      setError((reason as Error).message);
    } finally {
      setUploading(false);
    }
  }
  function removeImage(image: PendingImage) {
    assistant.setDraft((value) => ({
      ...value,
      images: value.images.filter((item) => item.uri !== image.uri),
      requestId: undefined,
    }));
    void removeLocalImage(image.uri);
    if (image.uploaded)
      void chatRequest(`/images/${image.uploaded.id}`, "DELETE").catch(
        () => undefined,
      );
  }
  async function picker(source: ImageSource) {
    try {
      if (source === "clipboard") {
        const image = await Clipboard.getImageAsync({ format: "png" });
        if (!image) {
          setError(
            "No image available in the clipboard, or paste permission was denied.",
          );
          return;
        }
        const uri = `${FS.cacheDirectory}assistant-paste-${Date.now()}.png`;
        await FS.writeAsStringAsync(
          uri,
          image.data.replace(/^data:image\/[^;]+;base64,/, ""),
          { encoding: FS.EncodingType.Base64 },
        );
        await addImages([{ uri, name: "Pasted image.png", type: "image/png" }]);
        await FS.deleteAsync(uri, { idempotent: true });
        return;
      }
      if (source === "screenshot") {
        const uri = await assistant.screenshot();
        setPreview({
          uri,
          candidate: { uri, name: "Screen context.png", type: "image/png" },
        });
        return;
      }
      if (source === "files") {
        const result = await DocumentPicker.getDocumentAsync({
          type: ["image/jpeg", "image/png"],
          multiple: true,
          copyToCacheDirectory: true,
        });
        if (!result.canceled)
          await addImages(
            result.assets.map((asset) => ({
              uri: asset.uri,
              name: asset.name,
              type: asset.mimeType || "image/jpeg",
            })),
          );
        return;
      }
      if (
        source === "camera" &&
        !(await ImagePicker.requestCameraPermissionsAsync()).granted
      ) {
        setError("Allow camera access to take a receipt photo.");
        return;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 1,
        allowsMultipleSelection: source === "library",
        selectionLimit: Math.max(1, 5 - draft.images.length),
      };
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const images: PendingImage[] = [];
      for (const asset of result.assets) {
        const image = ImageManipulator.ImageManipulator.manipulate(asset.uri);
        if (asset.width * asset.height > 20_000_000) {
          const factor = Math.sqrt(20_000_000 / (asset.width * asset.height));
          image.resize({
            width: Math.floor(asset.width * factor),
            height: Math.floor(asset.height * factor),
          });
        }
        const rendered = await image.renderAsync();
        const saved = await rendered.saveAsync({
          format: ImageManipulator.SaveFormat.JPEG,
          compress: 0.9,
        });
        images.push({
          uri: saved.uri,
          name: `${asset.fileName?.replace(/\.[^.]+$/, "") || "Photo"}.jpg`,
          type: "image/jpeg",
        });
      }
      await addImages(images);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function discardDraft() {
    cachedDraft?.images.forEach((image) => {
      void removeLocalImage(image.uri);
      if (image.uploaded)
        void chatRequest(`/images/${image.uploaded.id}`, "DELETE").catch(
          () => undefined,
        );
    });
    assistant.updateCache((cache) => ({ ...cache, draft: null }));
  }
  function newChat() {
    if (
      cachedDraft &&
      (cachedDraft.text || cachedDraft.images.length || cachedDraft.requestId)
    ) {
      assistant.select(cachedDraft.conversationId ?? null);
      setPage("chat");
      toast("Restored your unsent draft.");
      return;
    }
    assistant.updateCache((cache) => ({ ...cache, draft: emptyDraft() }));
    assistant.select(null);
    setPage("chat");
  }
  async function rename(chatId: string, title: string) {
    try {
      const next = await renameChat(chatId, title);
      queryClient.setQueryData(["chat", uid, chatId], next);
      void queryClient.invalidateQueries({ queryKey: listKey });
      assistant.updateCache((cache) => ({
        ...cache,
        chats: cache.chats.map((c) => (c.id === chatId ? { ...c, title } : c)),
        conversations: cache.conversations[chatId]
          ? {
              ...cache.conversations,
              [chatId]: { ...cache.conversations[chatId], title },
            }
          : cache.conversations,
      }));
    } catch (reason) {
      toast((reason as Error).message);
      throw reason;
    }
  }
  async function remove(chatId: string) {
    try {
      await deleteChat(chatId);
      queryClient.removeQueries({ queryKey: ["chat", uid, chatId] });
      void queryClient.invalidateQueries({ queryKey: listKey });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      assistant.updateCache((cache) => ({
        ...cache,
        chats: cache.chats.filter((c) => c.id !== chatId),
        conversations: Object.fromEntries(
          Object.entries(cache.conversations).filter(([key]) => key !== chatId),
        ),
        receiptEdits: Object.fromEntries(
          Object.entries(cache.receiptEdits).filter(([key]) => key !== chatId),
        ),
        draft: cache.draft?.conversationId === chatId ? null : cache.draft,
      }));
      if (id === chatId) assistant.select(null);
      toast("Conversation deleted");
    } catch (reason) {
      toast((reason as Error).message);
    }
  }
  function openLink(href: string) {
    const timely = href.match(
      /^timely:\/\/(task|project|doc|sheet|event)\/([^/?#]+)/,
    );
    if (timely) {
      // Docs and sheets share the Files routes, keyed by the ID's prefix.
      assistant.openResult(
        timely[1] === "doc" || timely[1] === "sheet"
          ? fileHref(timely[2])
          : `/(app)/${timely[1]}s/${encodeURIComponent(timely[2])}`,
      );
      return;
    }
    if (href.startsWith("/")) {
      const task = href.match(/^\/tasks\?taskId=([^&]+)/);
      const legacyFile = legacyFilePath(href);
      if (task) assistant.openResult(`/(app)/tasks/${task[1]}`);
      else if (legacyFile) assistant.openResult(legacyFile);
      else if (
        /^\/(tasks|projects|files|events|calendar|today|settings)(\/|\?|$)/.test(
          href,
        )
      )
        assistant.openResult(`/(app)${href}`);
      return;
    }
    if (/^https?:\/\//i.test(href))
      void Linking.openURL(href).catch(() =>
        setError("Couldn't open this link."),
      );
  }
  function close() {
    if (preview) {
      setPreview(undefined);
      return;
    }
    if (page !== "chat") {
      setPage("chat");
      setReviewSteps(null);
      return;
    }
    assistant.close();
  }
  useEffect(() => {
    assistant.setBackHandler(close);
    return () => assistant.setBackHandler(null);
  }, [page, preview]);
  const locked = busy || pending || offline;
  const review = chat?.imageReview;
  const receiptConfirmation =
    !!review?.receipt &&
    !!review.destination &&
    !reviewSteps &&
    chat?.status === "approval";
  const savedReceipt = review?.status === "confirmed" && !!review.receipt;
  const savedSheetStep = chat?.plan.findLast(
    (step) => step.status === "done" && step.tool.includes("sheet"),
  );
  const savedSheet = savedSheetStep?.result?.sheet as
    | { id?: string }
    | undefined;
  const savedSheetId =
    savedSheet?.id ||
    (typeof savedSheetStep?.result?.id === "string"
      ? savedSheetStep.result.id
      : review?.destination?.sheetId);
  const hasDraft = !!(draft.text || draft.images.length);
  const title = preview
    ? "Image preview"
    : page === "history"
      ? "Chats"
      : page === "receipt"
        ? "Check your receipt"
        : page === "proposal"
          ? reviewSteps
            ? "Earlier changes"
            : receiptConfirmation
              ? "Confirm receipt"
              : "Review changes"
          : chat?.title || "New conversation";
  const subtitle = offline
    ? "Offline · drafts and cached history"
    : busy
      ? phaseLabel(chat?.phase)
      : page === "history"
        ? `${list.data?.length ?? 0} ${list.data?.length === 1 ? "conversation" : "conversations"}`
        : page === "receipt"
          ? "Step 1 of 2 · Check details"
          : receiptConfirmation
            ? "Step 2 of 2 · Confirm and save"
            : page === "proposal"
              ? "Nothing is saved until you apply"
              : chat?.status === "approval"
                ? "Waiting for your decision"
                : chat?.provider
                  ? `${PROVIDER_LABELS[chat.provider as ProviderId] ?? chat.provider}${chat.model ? ` · ${chat.model}` : ""}`
                  : "Ask about your work";
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <AssistantHeader
          title={title}
          subtitle={subtitle}
          status={page === "chat" && !preview ? chat?.status : undefined}
          phase={chat?.phase}
          back={page !== "chat" || !!preview}
          onBack={close}
          actions={
            page === "chat" && !preview ? (
              <>
                <IconButton
                  label={
                    unreadCount
                      ? `Chat history, ${unreadCount} unread`
                      : "Chat history"
                  }
                  onPress={() => {
                    setPreview(undefined);
                    setPage("history");
                  }}
                >
                  <View>
                    <MessageCircle size={20} color={colors.foreground} />
                    {unreadCount ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </IconButton>
                <IconButton label="New chat" onPress={newChat}>
                  <Plus size={20} color={colors.foreground} />
                </IconButton>
              </>
            ) : null
          }
        />
        {preview ? (
          <View style={styles.preview}>
            <ScrollView
              maximumZoomScale={4}
              minimumZoomScale={1}
              contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
            >
              <Image
                source={{ uri: preview.uri }}
                style={{ width: "100%", height: 480 }}
                resizeMode="contain"
              />
            </ScrollView>
            {preview.candidate ? (
              <Action
                label="Attach screenshot"
                primary
                disabled={pending}
                onPress={() => {
                  void addImages([preview.candidate!]);
                  setPreview(undefined);
                }}
              />
            ) : null}
            <Action label="Back" onPress={() => setPreview(undefined)} />
          </View>
        ) : page === "history" ? (
          <HistoryPage
            chats={list.data ?? []}
            loading={list.isLoading}
            refreshing={list.isRefetching && !list.isPending}
            error={list.error?.message}
            offline={offline}
            activeId={id}
            onRefresh={() => void list.refetch()}
            onOpen={(chatId) => {
              assistant.select(chatId);
              setPage("chat");
            }}
            onRename={rename}
            onDelete={remove}
          />
        ) : (
          <>
            <ScrollView
              ref={scroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              {page === "receipt" && chat && review?.receipt ? (
                <ReceiptReview
                  key={`${id}:${JSON.stringify(review.receipt)}:${JSON.stringify(review.destination)}`}
                  chat={chat}
                  pending={locked}
                  act={act}
                  onDirty={() => undefined}
                  onImage={(uri) => setPreview({ uri })}
                />
              ) : page === "proposal" && chat ? (
                <ProposalPage
                  chat={chat}
                  steps={reviewSteps ?? chat.plan}
                  archived={!!reviewSteps}
                  receiptConfirmation={receiptConfirmation}
                  receiptDirty={receiptDirty}
                  locked={locked}
                  pending={pending}
                  offline={offline}
                  act={act}
                  onLink={openLink}
                  onEditReceipt={() => setPage("receipt")}
                />
              ) : (
                <>
                  {id && query.isLoading ? (
                    <TimelyLogo
                      size={40}
                      animated
                      style={{ alignSelf: "center", marginTop: 24 }}
                    />
                  ) : null}
                  {id && !chat && offline ? (
                    <StatusCard
                      tone="warning"
                      icon={WifiOff}
                      title="This conversation is not cached"
                      body="Reconnect to load it. Cached chats open offline from history."
                    />
                  ) : null}
                  {id && !chat && !offline && query.error ? (
                    <StatusCard
                      tone="destructive"
                      icon={AlertTriangle}
                      title="Couldn't load this conversation"
                      body={query.error.message}
                    >
                      <Action
                        label="Try again"
                        compact
                        onPress={() => void query.refetch()}
                      />
                    </StatusCard>
                  ) : null}
                  {!id ? (
                    <Welcome disabled={otherDraft} onPick={editText} />
                  ) : null}
                  {chat ? (
                    <Thread
                      chat={chat}
                      onLink={openLink}
                      onPreviewImage={(uri) => setPreview({ uri })}
                      onReviewArchive={(steps) => {
                        setReviewSteps(steps);
                        setPage("proposal");
                      }}
                      onOpenChat={(next) => assistant.select(next)}
                    />
                  ) : null}
                  {savedReceipt && review?.receipt ? (
                    <StatusCard
                      tone="success"
                      icon={ReceiptText}
                      title="Receipt saved"
                      body={`${review.receipt.merchant} · ${review.receipt.currency} ${review.receipt.total}`}
                    >
                      {savedSheetId ? (
                        <Action
                          label="Open expense sheet"
                          compact
                          onPress={() =>
                            openLink(
                              `/files/${encodeURIComponent(savedSheetId)}`,
                            )
                          }
                        />
                      ) : null}
                    </StatusCard>
                  ) : null}
                  {review?.status === "review" && review.receipt ? (
                    <StatusCard
                      tone="warning"
                      icon={ReceiptText}
                      title={
                        chat?.status === "approval"
                          ? "Receipt ready to save"
                          : "Receipt needs a check"
                      }
                      body="Review the extracted details and choose where to save them."
                    >
                      <Action
                        label={
                          chat?.status === "approval"
                            ? "Edit receipt details"
                            : "Check receipt details"
                        }
                        primary={chat?.status !== "approval"}
                        compact
                        onPress={() => setPage("receipt")}
                      />
                    </StatusCard>
                  ) : null}
                  {review?.status === "review" && !review.receipt ? (
                    <StatusCard
                      tone="primary"
                      icon={ReceiptText}
                      title="Keep the extracted text?"
                      body="Confirm to remove temporary images and keep what was read from them."
                    >
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Action
                            label="Confirm"
                            primary
                            compact
                            disabled={locked}
                            onPress={() =>
                              act("/images/confirm", {
                                revision: chat?.revision,
                              })
                            }
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Action
                            label="Discard images"
                            compact
                            disabled={pending || offline}
                            onPress={() => act("/images/discard")}
                          />
                        </View>
                      </View>
                    </StatusCard>
                  ) : null}
                  {chat?.plan?.length ? (
                    <PlanSummary
                      chat={chat}
                      onLink={openLink}
                      onOpen={() => {
                        setReviewSteps(null);
                        setPage("proposal");
                      }}
                    />
                  ) : null}
                  {chat ? <RunStatus chat={chat} /> : null}
                  {chat ? (
                    <FailureCard
                      chat={chat}
                      locked={locked}
                      onRetry={() => act("/retry")}
                    />
                  ) : null}
                </>
              )}
              {error ? (
                <View style={styles.inlineError}>
                  <AlertTriangle size={16} color={colors.destructive} />
                  <Text style={[styles.errorText, { flex: 1 }]}>{error}</Text>
                </View>
              ) : null}
            </ScrollView>
            {page === "chat" ? (
              <Composer
                text={draft.text}
                onChangeText={editText}
                placeholder={
                  draft.images.length
                    ? "Add a note (optional)…"
                    : chat?.status === "approval"
                      ? "Tell me what to change…"
                      : "Ask Timely…"
                }
                chips={context}
                onRemoveChip={(index) =>
                  configure(context.filter((_, i) => i !== index))
                }
                onAddScreen={addScreen}
                canConfigure={canConfigure}
                images={draft.images}
                onPreview={(uri) => setPreview({ uri })}
                onRemoveImage={removeImage}
                onAttach={() => setAttachOpen(true)}
                search={search}
                onToggleSearch={() => configure(context, !search)}
                modelLabel={modelLabel(model)}
                modelChosen={!!model.provider}
                canPickModel={canPickModel}
                onPickModel={() => setModelOpen(true)}
                privateImages={!!chat?.sensitive || draft.images.length > 0}
                busy={busy}
                pending={pending}
                uploading={uploading}
                offline={offline}
                editable={!pending && !busy}
                onSend={() => void send()}
                onStop={() => act("/stop")}
                hasDraft={hasDraft}
                onDiscardDraft={() => setConfirmDiscard(true)}
                otherDraft={otherDraft}
                onReturnDraft={() =>
                  assistant.select(cachedDraft?.conversationId ?? null)
                }
              />
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>
      <ModelSheet
        open={modelOpen}
        value={model}
        onClose={() => setModelOpen(false)}
        onPick={chooseModel}
      />
      <AttachSheet
        open={attachOpen}
        remaining={Math.max(0, 5 - draft.images.length)}
        onClose={() => setAttachOpen(false)}
        onPick={(source) => void picker(source)}
      />
      <ConfirmSheet
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard unsent draft?"
        message="Its text, context and attachments will be removed."
        confirmLabel="Discard"
        onConfirm={discardDraft}
      />
    </SafeAreaView>
  );
}

/** Compact entry point to the proposal page from the thread. */
function PlanSummary({
  chat,
  onOpen,
  onLink,
}: {
  chat: Chat;
  onOpen: () => void;
  onLink: (href: string) => void;
}) {
  const done = chat.plan.filter((step) => step.status === "done").length;
  const total = chat.plan.length;
  const approval = chat.status === "approval";
  const failed = chat.status === "failed";
  const applying = isBusy(chat.status) && chat.phase === "apply";
  // When everything applied changed one screen, open it straight from here.
  const target =
    !approval && !isBusy(chat.status) ? sharedTarget(chat.plan) : null;
  const tone = approval
    ? "warning"
    : failed
      ? "destructive"
      : done === total
        ? "success"
        : "primary";
  return (
    <StatusCard
      tone={tone}
      icon={ClipboardList}
      spinning={applying}
      title={
        approval
          ? "Changes ready for your review"
          : applying
            ? "Applying changes"
            : failed
              ? "Some changes did not finish"
              : chat.status === "stopped"
                ? "Stopped before finishing"
                : done === total
                  ? "Changes applied"
                  : "Your changes"
      }
      body={`${done} of ${total} ${total === 1 ? "change" : "changes"} applied`}
    >
      <View style={styles.planActions}>
        {target ? (
          <View style={{ flex: 1 }}>
            <Action
              label={`Open ${target.noun}`}
              icon={ArrowUpRight}
              primary
              compact
              onPress={() => onLink(target.href)}
            />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Action
            label={approval ? "Review and apply" : "View changes"}
            primary={approval}
            compact
            onPress={onOpen}
          />
        </View>
      </View>
    </StatusCard>
  );
}

const styles = createThemedStyleSheet(() => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 24, gap: 16, flexGrow: 1 },
  preview: { flex: 1, padding: 16, gap: 12 },
  planActions: { flexDirection: "row", gap: 10 },
  badge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: colors.primaryForeground,
    fontSize: 9,
    fontWeight: "700",
  },
  inlineError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    backgroundColor: `${colors.destructive}14`,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: { color: colors.destructive, fontSize: 13, lineHeight: 19 },
}));
