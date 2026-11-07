import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  needsYouCount,
  type BotInput,
  type BotPatch,
  type BotSettings,
  type FeedbackInput,
  type PreviewInput,
} from "@timely/contract/bots";
import {
  botIcons,
  createBot,
  deleteBot,
  forgetLesson,
  getBot,
  getBotDefaults,
  listBots,
  listSourceKeys,
  pauseBot,
  previewBot,
  rateAlert,
  removeSourceKey,
  resumeBot,
  runBot,
  setBotDefaults,
  setSourceKey,
  snoozeBot,
  updateBot,
  type SnoozeBody,
} from "../api/bots";
import { apiFetch } from "../api/client";
import { startLiveStream } from "../api/chatStream";

export const botsKey = ["bots"] as const;
export const botKey = (id: string) => ["bot", id] as const;
export const botIconsKey = (sites: string[]) =>
  ["bot-icons", ...[...sites].sort()] as const;
export const previewKey = (input: PreviewInput | null | undefined) =>
  ["bot-preview", stableHash(input)] as const;
export const sourceKeysKey = ["bot-source-keys"] as const;
export const botDefaultsKey = ["bot-defaults"] as const;

/** The Web Lock and BroadcastChannel name of the bots stream, apart from the chat stream's. */
export const BOT_STREAM_LOCK = "timely-bot-stream";

/** JSON with object keys sorted, so the same input always makes the same key. */
export function stableHash(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v: unknown) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : v,
    ) ?? ""
  );
}

// The bots stream (useBotStream) says when a check finishes or an alert fires.
// While it is down the board is polled once a minute; while it is up it is not
// polled at all, since every change arrives on the stream.
const IDLE_POLL = 60_000;
let botStreaming = false;

export function useBots() {
  return useQuery({
    queryKey: botsKey,
    queryFn: listBots,
    refetchInterval: () => (botStreaming ? false : IDLE_POLL),
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });
}

export function useBot(id?: string | null) {
  return useQuery({
    queryKey: botKey(id || ""),
    queryFn: () => getBot(id || ""),
    enabled: !!id,
    refetchInterval: () => (botStreaming ? false : IDLE_POLL),
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });
}

/** How many bots need the person (the sidebar badge). */
export function useNeedsYouCount(): number {
  const { data } = useBots();
  return needsYouCount(data?.bots);
}

/** Site logos as data URIs. Logos change rarely, so a day's cache is fine. */
export function useBotIcons(sites: string[]) {
  return useQuery({
    queryKey: botIconsKey(sites),
    queryFn: () => botIcons([...sites].sort()),
    enabled: sites.length > 0,
    staleTime: 24 * 60 * 60_000,
  });
}

/**
 * One reading of the watches, saved nowhere. The server keeps a reading for
 * 10 minutes too, so the same input never reads the site twice in that time.
 */
export function useBotPreview(
  input: PreviewInput | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: previewKey(input),
    queryFn: () => previewBot(input as PreviewInput),
    enabled: enabled && !!input,
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSourceKeys() {
  return useQuery({
    queryKey: sourceKeysKey,
    queryFn: listSourceKeys,
    staleTime: 30_000,
  });
}

export function useBotDefaults(enabled = true) {
  return useQuery({
    queryKey: botDefaultsKey,
    queryFn: getBotDefaults,
    staleTime: 60_000,
    enabled,
  });
}

function invalidateBot(cache: QueryClient, id?: string) {
  void cache.invalidateQueries({ queryKey: botsKey });
  if (id) void cache.invalidateQueries({ queryKey: botKey(id) });
}

export function useCreateBot() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: BotInput) => createBot(input),
    onSuccess: (view) => invalidateBot(cache, view.id),
  });
}

export function useUpdateBot() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BotPatch }) =>
      updateBot(id, patch),
    onSuccess: (_, { id }) => invalidateBot(cache, id),
  });
}

export function useDeleteBot() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBot(id),
    onSuccess: (_, id) => {
      cache.removeQueries({ queryKey: botKey(id) });
      invalidateBot(cache);
      void cache.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function usePauseBot() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pauseBot(id),
    onSuccess: (_, id) => invalidateBot(cache, id),
  });
}

/** Resume, and "Turn on" for a bot an outside app made. */
export function useResumeBot() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumeBot(id),
    onSuccess: (_, id) => invalidateBot(cache, id),
  });
}

export function useSnoozeBot() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SnoozeBody }) =>
      snoozeBot(id, body),
    onSuccess: (_, { id }) => invalidateBot(cache, id),
  });
}

export function useRunBot() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runBot(id),
    onSuccess: (_, id) => invalidateBot(cache, id),
  });
}

export function useRateAlert() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({
      botId,
      alertId,
      body,
    }: {
      botId: string;
      alertId: string;
      body: FeedbackInput;
    }) => rateAlert(botId, alertId, body),
    onSuccess: (_, { botId }) => invalidateBot(cache, botId),
  });
}

export function useForgetLesson() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ botId, lessonId }: { botId: string; lessonId: string }) =>
      forgetLesson(botId, lessonId),
    onSuccess: (_, { botId }) => invalidateBot(cache, botId),
  });
}

/** A saved or removed key changes which stock bots can read, so bots refetch too. */
export function useSetSourceKey() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ source, key }: { source: string; key: string }) =>
      setSourceKey(source, key),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: sourceKeysKey });
      void cache.invalidateQueries({ queryKey: botsKey });
    },
  });
}

export function useRemoveSourceKey() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (source: string) => removeSourceKey(source),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: sourceKeysKey });
      void cache.invalidateQueries({ queryKey: botsKey });
    },
  });
}

export function useSetBotDefaults() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (settings: BotSettings) => setBotDefaults(settings),
    onSuccess: (saved) => cache.setQueryData(botDefaultsKey, saved),
  });
}

/** Keeps bots current from the live stream; mounted once, in BotRuntime. */
export function useBotStream() {
  const cache = useQueryClient();
  useEffect(() => {
    const changed = new Set<string>();
    let all = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A check writes its row, its alert and the bot in a row; one refetch covers the burst.
    const flush = () => {
      timer = undefined;
      void cache.invalidateQueries({ queryKey: botsKey });
      if (all) void cache.invalidateQueries({ queryKey: ["bot"] });
      else
        for (const id of changed)
          void cache.invalidateQueries({ queryKey: botKey(id) });
      // An alert is also a notification.
      void cache.invalidateQueries({ queryKey: ["notifications"] });
      changed.clear();
      all = false;
    };
    const channel =
      typeof BroadcastChannel === "undefined"
        ? undefined
        : new BroadcastChannel(BOT_STREAM_LOCK);
    const stop = startLiveStream(
      (message) => {
        if (message.type === "live") {
          if (botStreaming === message.live) return;
          // Refetching also re-times the polls, and catches up on a gap.
          botStreaming = message.live;
          all = true;
        } else changed.add(message.id);
        timer ??= setTimeout(flush, 250);
      },
      {
        open: (signal) => apiFetch("/bots/watch", { signal }),
        locks: typeof navigator === "undefined" ? undefined : navigator.locks,
        lock: BOT_STREAM_LOCK,
        channel,
      },
    );
    return () => {
      stop();
      clearTimeout(timer);
      botStreaming = false;
    };
  }, [cache]);
}
