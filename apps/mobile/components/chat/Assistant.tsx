import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  MessageCircle,
  Plus,
  X,
  Sparkles,
  ArrowLeft,
} from "lucide-react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FS from "expo-file-system/legacy";
import { useAuth } from "../../lib/auth/AuthProvider";
import { chatRequest, uploadChatImage } from "../../lib/api/chat";
import { isOffline, subscribeOffline } from "../../lib/networkState";
import { mergeContext } from "../../lib/chat/context";
import { removeLocalImage, retainImage } from "../../lib/chat/storage";
import type { Chat, ChatStep, PendingImage } from "../../lib/chat/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { emptyDraft, useAssistant } from "../../lib/chat/runtime";
import { Action, ChatText, DetailValue, styles as common } from "./shared";
import ImagePreview from "./ImagePreview";
import ReceiptReview, { ReceiptSaveSummary } from "./ReceiptReview";

export default function Assistant() {
  const assistant = useAssistant();
  const { user } = useAuth();
  const uid = user!.id;
  const id = assistant.chatId;
  const queryClient = useQueryClient();
  const [offline, setOfflineState] = useState(isOffline());
  const [page, setPage] = useState<"chat" | "history" | "proposal" | "receipt">(
    "chat",
  );
  const [historySearch, setHistorySearch] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

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
    queryFn: () => chatRequest<Chat>(`/${id}`),
    enabled: !!id && assistant.visible && assistant.foreground && !offline,
    initialData: id ? assistant.cache.conversations[id] : undefined,
    refetchInterval: (q) =>
      assistant.foreground &&
      !offline &&
      ["queued", "running"].includes(q.state.data?.status ?? "")
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
    refetchInterval: assistant.foreground && !offline ? 5000 : false,
  });
  const chat = id ? query.data : undefined;
  const busy = !!chat && ["queued", "running"].includes(chat.status);
  const cachedDraft = assistant.cache.draft;
  const matchingDraft =
    cachedDraft && (cachedDraft.conversationId ?? null) === id;
  const draft = matchingDraft ? cachedDraft : emptyDraft(chat?.context ?? []);
  const otherDraft =
    cachedDraft &&
    !matchingDraft &&
    (cachedDraft.text || cachedDraft.images.length || cachedDraft.requestId);
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
  const lastRevision = useRef<number | undefined>(undefined);
  const openedReceipt = useRef("");
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
      void chatRequest(`/${chat.id}/read`, "POST")
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
  }, [chat?.messages?.length]);

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
        target ? `/${target}${action}` : "",
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
        ["/receipt", "/images/discard", "/images/confirm", "/approve"].includes(
          variables.action,
        )
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
      if (
        ["/images/discard", "/images/confirm", "/approve"].includes(
          variables.action,
        )
      ) {
        setPage("chat");
      }
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
  function configure(nextContext = context, webSearch = search) {
    if (busy || pending || (offline && id)) return;
    if (id) act("", { context: nextContext, webSearch });
    else
      assistant.setDraft((value) => ({
        ...value,
        context: nextContext,
        webSearch,
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
          ...(!id ? { context, webSearch: search } : {}),
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
  async function picker(
    source: "camera" | "library" | "files" | "screenshot" | "clipboard",
  ) {
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
  function attachMenu() {
    Alert.alert(
      "Attach image",
      "Up to five images. Temporary uploads expire after 24 hours.",
      [
        { text: "Camera", onPress: () => void picker("camera") },
        { text: "Photo library", onPress: () => void picker("library") },
        {
          text: "More sources",
          onPress: () =>
            Alert.alert("Image source", undefined, [
              { text: "Image files", onPress: () => void picker("files") },
              {
                text: "Capture current screen",
                onPress: () => void picker("screenshot"),
              },
              { text: "Paste image", onPress: () => void picker("clipboard") },
            ]),
        },
      ],
    );
  }
  function discardDraft() {
    if (pending) return;
    Alert.alert(
      "Discard unsent draft?",
      "Its text, context and attachments will be removed.",
      [
        { text: "Keep draft", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            cachedDraft?.images.forEach((image) => {
              void removeLocalImage(image.uri);
              if (image.uploaded)
                void chatRequest(
                  `/images/${image.uploaded.id}`,
                  "DELETE",
                ).catch(() => undefined);
            });
            assistant.updateCache((cache) => ({ ...cache, draft: null }));
          },
        },
      ],
    );
  }
  function newChat() {
    if (
      cachedDraft &&
      (cachedDraft.text || cachedDraft.images.length || cachedDraft.requestId)
    ) {
      assistant.select(cachedDraft.conversationId ?? null);
      setPage("chat");
      return;
    }
    assistant.updateCache((cache) => ({ ...cache, draft: emptyDraft() }));
    assistant.select(null);
    setPage("chat");
  }
  function openLink(href: string) {
    const timely = href.match(
      /^timely:\/\/(task|project|doc|sheet|event)\/([^/?#]+)/,
    );
    if (timely) {
      assistant.openResult(
        `/(app)/${timely[1]}s/${encodeURIComponent(timely[2])}`,
      );
      return;
    }
    if (href.startsWith("/")) {
      const task = href.match(/^\/tasks\?taskId=([^&]+)/);
      if (task) assistant.openResult(`/(app)/tasks/${task[1]}`);
      else if (
        /^\/(tasks|projects|docs|sheets|events|calendar|today)(\/|\?|$)/.test(
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
  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={
              page === "chat" && !preview ? "Close assistant" : "Back to chat"
            }
            onPress={close}
            style={styles.icon}
          >
            {page === "chat" && !preview ? (
              <X color={colors.foreground} size={22} />
            ) : (
              <ArrowLeft color={colors.foreground} size={22} />
            )}
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.title}>
              {preview
                ? "Image preview"
                : page === "history"
                  ? "Chat history"
                  : page === "receipt"
                    ? "Receipt review"
                    : page === "proposal"
                      ? receiptConfirmation
                        ? "Confirm receipt"
                        : "Review changes"
                      : chat?.title || "Timely assistant"}
            </Text>
            <Text style={common.muted}>
              {offline
                ? "Offline · drafts and cached history"
                : busy
                  ? "Working · you can leave this chat"
                  : page === "receipt"
                    ? "Step 1 of 2 · Check details"
                    : receiptConfirmation
                      ? "Step 2 of 2 · Confirm and save"
                      : "Ask about your work"}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Chat history"
            onPress={() => {
              setPreview(undefined);
              setPage("history");
            }}
            style={styles.icon}
          >
            <MessageCircle color={colors.primary} size={22} />
          </Pressable>
          <Pressable
            accessibilityLabel="New chat"
            onPress={newChat}
            style={styles.icon}
          >
            <Plus color={colors.primary} size={22} />
          </Pressable>
        </View>
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
            {preview.candidate && (
              <Action
                label="Attach screenshot"
                primary
                disabled={pending}
                onPress={() => {
                  void addImages([preview.candidate!]);
                  setPreview(undefined);
                }}
              />
            )}
            <Action label="Back" onPress={() => setPreview(undefined)} />
          </View>
        ) : page === "history" ? (
          <View style={{ flex: 1, padding: 16, gap: 12 }}>
            <TextInput
              accessibilityLabel="Search chat history"
              placeholder="Search conversations"
              placeholderTextColor={colors.mutedForeground}
              value={historySearch}
              onChangeText={setHistorySearch}
              style={styles.input}
            />
            <ScrollView>
              {(list.data ?? [])
                .filter((item) =>
                  item.title
                    .toLowerCase()
                    .includes(historySearch.toLowerCase()),
                )
                .map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.historyRow}
                    onPress={() => {
                      assistant.select(item.id);
                      setPage("chat");
                    }}
                  >
                    <Text style={styles.title}>
                      {item.unread ? "● " : ""}
                      {item.title}
                    </Text>
                    <Text style={common.muted}>
                      {item.status === "approval"
                        ? "Needs approval"
                        : item.status}{" "}
                      · {new Date(item.updatedAt).toLocaleString()}
                    </Text>
                  </Pressable>
                ))}
              {!list.data?.length && (
                <Text style={common.muted}>
                  Your conversations appear here after sending a message.
                </Text>
              )}
            </ScrollView>
          </View>
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
                <>
                  {receiptConfirmation && review?.receipt ? (
                    <ReceiptSaveSummary
                      receipt={review.receipt}
                      destination={review.destination!}
                    />
                  ) : (
                    <Text style={common.muted}>
                      {
                        chat.plan.filter((step) => step.status === "done")
                          .length
                      }{" "}
                      / {chat.plan.length} complete
                    </Text>
                  )}
                  {!receiptConfirmation && (
                    <ChangeCards
                      steps={reviewSteps ?? chat.plan}
                      onLink={openLink}
                    />
                  )}
                  {!reviewSteps && chat.status === "approval" && (
                    <>
                      {receiptDirty && (
                        <Text style={common.muted}>
                          Receipt details changed. Return to the receipt and
                          continue again to update this preview.
                        </Text>
                      )}
                      <Action
                        label={
                          receiptConfirmation ? "Save receipt" : "Apply changes"
                        }
                        primary
                        disabled={locked || receiptDirty}
                        onPress={() =>
                          act("/approve", { revision: chat.revision })
                        }
                      />
                      {receiptConfirmation && (
                        <Action
                          label="Back to edit receipt"
                          disabled={locked}
                          onPress={() => setPage("receipt")}
                        />
                      )}
                    </>
                  )}
                  {receiptConfirmation && (
                    <ChangeCards steps={chat.plan} onLink={openLink} compact />
                  )}
                </>
              ) : (
                <>
                  {id && query.isLoading && (
                    <ActivityIndicator color={colors.primary} />
                  )}
                  {id && !chat && offline && (
                    <Text style={common.muted}>
                      This conversation is not cached. Reconnect to load it.
                    </Text>
                  )}
                  {!id && (
                    <View style={styles.welcome}>
                      <Sparkles size={32} color={colors.primary} />
                      <Text style={styles.hero}>
                        What would you like to make happen?
                      </Text>
                      <Text style={common.text}>
                        Plan your day, shape a sheet, or attach a receipt photo
                        to save an expense.
                      </Text>
                      {[
                        "Help me plan today.",
                        "Create a project budget sheet with Item, Quantity, Unit price, and Total columns.",
                        "Create a workspace for learning Japanese and add three study sessions.",
                      ].map((text) => (
                        <Action
                          key={text}
                          label={text}
                          onPress={() => editText(text)}
                          disabled={!!otherDraft}
                        />
                      ))}
                    </View>
                  )}
                  {chat?.messages?.map((message) => (
                    <View
                      key={message.id}
                      style={[
                        styles.message,
                        message.role === "user" && styles.userMessage,
                      ]}
                    >
                      <Text style={styles.speaker}>
                        {message.role === "user" ? "You" : "Timely"}
                      </Text>
                      <ChatText text={message.content} onLink={openLink} />
                      {(chat.images ?? [])
                        .filter((image) => message.imageIds?.includes(image.id))
                        .map((image) => (
                          <ImagePreview
                            key={image.id}
                            image={image}
                            onOpen={(uri) => setPreview({ uri })}
                          />
                        ))}
                      {message.receipt && (
                        <View style={common.stack}>
                          <Text style={common.text}>
                            {message.receipt.merchant} ·{" "}
                            {message.receipt.currency} {message.receipt.total} ·{" "}
                            {message.receipt.date}
                          </Text>
                          {message.receipt.items.map((item, i) => (
                            <Text key={i} style={common.muted}>
                              {item.description} · {item.amount}
                            </Text>
                          ))}
                        </View>
                      )}
                      {!!message.steps?.length && (
                        <Action
                          label="Review previous changes"
                          onPress={() => {
                            setReviewSteps(message.steps!);
                            setPage("proposal");
                          }}
                        />
                      )}
                    </View>
                  ))}
                  {savedReceipt && review?.receipt && (
                    <View style={styles.change}>
                      <Text style={styles.title}>✓ Receipt saved</Text>
                      <Text style={common.text}>
                        {review.receipt.merchant} · {review.receipt.currency}{" "}
                        {review.receipt.total}
                      </Text>
                      {savedSheetId && (
                        <Action
                          label="Open expense sheet"
                          primary
                          onPress={() => openLink(`/sheets/${savedSheetId}`)}
                        />
                      )}
                    </View>
                  )}
                  {review?.status === "review" && review.receipt && (
                    <Action
                      label={
                        chat?.status === "approval"
                          ? "Edit receipt details"
                          : "Check receipt details"
                      }
                      primary={chat?.status !== "approval"}
                      onPress={() => setPage("receipt")}
                    />
                  )}
                  {review?.status === "review" && !review.receipt && (
                    <View style={common.stack}>
                      <Text style={common.muted}>
                        Confirm to remove temporary images and keep extracted
                        text.
                      </Text>
                      <Action
                        label="Confirm image review"
                        disabled={locked}
                        onPress={() =>
                          act("/images/confirm", { revision: chat?.revision })
                        }
                      />
                      <Action
                        label="Discard images"
                        disabled={pending || offline}
                        onPress={() => act("/images/discard")}
                      />
                    </View>
                  )}
                  {!!chat?.plan?.length && (
                    <Action
                      label={
                        chat.status === "approval"
                          ? "Review proposed changes"
                          : "View changes and progress"
                      }
                      primary={chat.status === "approval"}
                      onPress={() => {
                        setReviewSteps(null);
                        setPage("proposal");
                      }}
                    />
                  )}
                  {busy && (
                    <View style={common.stack}>
                      <ActivityIndicator color={colors.primary} />
                      <Text style={common.muted}>
                        {chat?.phase === "apply"
                          ? "Saving your changes…"
                          : chat?.phase === "extract"
                            ? "Reading your images…"
                            : chat?.phase === "receipt_edit"
                              ? "Revising your receipt…"
                              : "Thinking it through…"}{" "}
                        You can leave this chat.
                      </Text>
                    </View>
                  )}
                  {chat?.error && (
                    <Text style={styles.error}>{chat.error}</Text>
                  )}
                  {chat && ["failed", "stopped"].includes(chat.status) && (
                    <Action
                      label={
                        chat.phase === "apply"
                          ? "Review unfinished changes"
                          : "Try again"
                      }
                      disabled={locked}
                      onPress={() => act("/retry")}
                    />
                  )}
                </>
              )}
              {(error || query.error?.message || list.error?.message) && (
                <Text style={styles.error}>
                  {error || query.error?.message || list.error?.message}
                </Text>
              )}
            </ScrollView>
            {page === "chat" && (
              <View style={styles.composer}>
                {otherDraft ? (
                  <View style={common.stack}>
                    <Text style={common.muted}>
                      You have an unsent draft in another conversation.
                    </Text>
                    <Action
                      label="Return to unsent draft"
                      onPress={() =>
                        assistant.select(cachedDraft.conversationId ?? null)
                      }
                    />
                    <Action
                      label="Discard unsent draft"
                      onPress={discardDraft}
                    />
                  </View>
                ) : (
                  <>
                    {!!context.length && (
                      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
                        {context.map((chip, index) => (
                          <Pressable
                            key={`${chip.kind}:${index}`}
                            disabled={busy || pending}
                            onPress={() =>
                              configure(context.filter((_, i) => i !== index))
                            }
                            style={styles.chip}
                          >
                            <Text numberOfLines={1} style={common.muted}>
                              {chip.label} ×
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                    {!!draft.images.length && (
                      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
                        {draft.images.map((image) => (
                          <View key={image.uri}>
                            <Pressable
                              onPress={() => setPreview({ uri: image.uri })}
                            >
                              <Image
                                source={{ uri: image.uri }}
                                style={{
                                  width: 72,
                                  height: 72,
                                  borderRadius: 12,
                                }}
                              />
                            </Pressable>
                            <Action
                              label="Remove"
                              disabled={pending}
                              onPress={() => {
                                assistant.setDraft((value) => ({
                                  ...value,
                                  images: value.images.filter(
                                    (item) => item.uri !== image.uri,
                                  ),
                                  requestId: undefined,
                                }));
                                void removeLocalImage(image.uri);
                                if (image.uploaded)
                                  void chatRequest(
                                    `/images/${image.uploaded.id}`,
                                    "DELETE",
                                  ).catch(() => undefined);
                              }}
                            />
                          </View>
                        ))}
                      </ScrollView>
                    )}
                    <TextInput
                      accessibilityLabel="Message the assistant"
                      placeholder={
                        draft.images.length
                          ? "Add a note (optional)…"
                          : "Ask Timely…"
                      }
                      placeholderTextColor={colors.mutedForeground}
                      value={draft.text}
                      editable={!pending && !busy}
                      onChangeText={editText}
                      multiline
                      maxLength={16000}
                      style={[styles.input, { maxHeight: 130 }]}
                    />
                    <View style={styles.tools}>
                      <Action
                        label="Attach"
                        disabled={pending || busy || draft.images.length >= 5}
                        onPress={attachMenu}
                      />
                      <Action
                        label="Add current screen"
                        disabled={pending || busy || (!!id && offline)}
                        onPress={addScreen}
                      />
                      {busy ? (
                        <Action
                          label="Stop"
                          disabled={pending || offline}
                          onPress={() => act("/stop")}
                        />
                      ) : (
                        <Action
                          label={
                            uploading
                              ? "Uploading…"
                              : draft.images.length && !draft.text.trim()
                                ? "Read receipt"
                                : "Send"
                          }
                          primary
                          disabled={
                            locked ||
                            (!draft.text.trim() && !draft.images.length)
                          }
                          onPress={() => void send()}
                        />
                      )}
                    </View>
                    <View style={styles.search}>
                      <Switch
                        accessibilityLabel="Web search"
                        value={
                          search && !chat?.sensitive && !draft.images.length
                        }
                        disabled={
                          busy ||
                          pending ||
                          chat?.sensitive ||
                          !!draft.images.length ||
                          (!!id && offline)
                        }
                        onValueChange={(value) => configure(context, value)}
                      />
                      <Text style={common.muted}>
                        {chat?.sensitive || draft.images.length
                          ? "Private images · web search unavailable"
                          : "Web search"}
                      </Text>
                      {draft.text || draft.images.length ? (
                        <Pressable disabled={pending} onPress={discardDraft}>
                          <Text style={common.muted}>Discard draft</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </>
                )}
              </View>
            )}
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function ChangeCards({
  steps,
  onLink,
  compact = false,
}: {
  steps: ChatStep[];
  onLink: (href: string) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ gap: 16 }}>
      {compact && (
        <Action
          label={expanded ? "Hide sheet changes" : "View sheet changes"}
          onPress={() => setExpanded(!expanded)}
        />
      )}
      {(!compact || expanded) &&
        steps.map((step, i) => {
          const result = step.result;
          const entries: [string, string][] = [
            ["sheet", "sheets"],
            ["task", "tasks"],
            ["project", "projects"],
            ["doc", "docs"],
            ["event", "events"],
          ];
          const links = entries.flatMap(([key, path]) => {
            const item = result?.[key] as
              | { id?: string; title?: string; name?: string }
              | undefined;
            return item?.id
              ? [
                  {
                    href: `/${path}/${item.id}`,
                    label: item.title || item.name || `Open ${key}`,
                  },
                ]
              : [];
          });
          if (!links.length && typeof result?.id === "string") {
            const path = step.tool.includes("sheet_template")
              ? "sheets/templates"
              : step.tool.includes("sheet")
                ? "sheets"
                : step.tool.includes("doc")
                  ? "docs"
                  : step.tool.includes("project")
                    ? "projects"
                    : step.tool.includes("event")
                      ? "events"
                      : step.tool.includes("task")
                        ? "tasks"
                        : "";
            if (path)
              links.push({
                href: `/${path}/${result.id}`,
                label: String(result.title || result.name || "Open item"),
              });
          }
          return (
            <View key={i} style={styles.change}>
              <Text style={styles.title}>
                {step.status === "done" ? "✓ " : `${i + 1}. `}
                {step.summary}
              </Text>
              <Text style={common.muted}>{step.status}</Text>
              {step.error && <Text style={styles.error}>{step.error}</Text>}
              {links.map((link) => (
                <Action
                  key={link.href}
                  label={link.label}
                  onPress={() => onLink(link.href)}
                />
              ))}
              <Text style={styles.speaker}>After</Text>
              <DetailValue value={step.arguments} onLink={onLink} />
              {step.before && (
                <>
                  <Text style={styles.speaker}>Before</Text>
                  <DetailValue value={step.before} onLink={onLink} />
                </>
              )}
            </View>
          );
        })}
    </View>
  );
}
const styles = createThemedStyleSheet(() => ({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  icon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  content: { padding: 20, gap: 20, flexGrow: 1 },
  hero: {
    color: colors.foreground,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
  },
  welcome: { gap: 20, paddingVertical: 20 },
  message: { gap: 8 },
  userMessage: {
    marginLeft: 24,
    padding: 16,
    borderRadius: 20,
    backgroundColor: colors.muted,
  },
  speaker: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  composer: {
    gap: 8,
    padding: 12,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  input: {
    minHeight: 48,
    color: colors.foreground,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.muted,
  },
  tools: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 220,
    borderRadius: 16,
    backgroundColor: colors.muted,
  },
  error: { color: colors.destructive, fontSize: 14, lineHeight: 22 },
  historyRow: {
    paddingVertical: 18,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
    gap: 4,
  },
  preview: { flex: 1, padding: 16, gap: 12 },
  change: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
    gap: 12,
  },
}));
