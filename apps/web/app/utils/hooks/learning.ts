import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  LearningSettings,
  LearningSettingsPatch,
  MemoryEdit,
  SkillState,
  UpstreamChoice,
} from "@timely/contract/agentLearning";
import {
  chooseUpstream,
  compareUpstream,
  decidePending,
  editLearnedSkill,
  editMemory,
  getLearnedSkill,
  getLearningSettings,
  getMemory,
  listLearnedSkills,
  listLearningEvents,
  listPending,
  listUpstream,
  patchLearningSettings,
  setSkillState,
  undoLearningEvent,
} from "../api/learning";
import { getWebKeys, removeWebKey, setWebKey } from "../api/webKeys";

/**
 * What the agent learned (plan 9b.4). Every query lives under learningKey,
 * so the chat stream's `learning` event and every change here refetch them
 * all at once: a chat's chip, Waiting for you, the skills and Activity.
 */
export const learningKey = ["agent-learning"] as const;
const key = (...parts: unknown[]) => [...learningKey, ...parts] as const;

/** The lists that come from the agent worker start it; they need not refetch often. */
const WORKER_STALE = 30_000;

export function useLearningSettings() {
  return useQuery({
    queryKey: key("settings"),
    queryFn: getLearningSettings,
    staleTime: 30_000,
  });
}

export function usePatchLearningSettings() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (patch: LearningSettingsPatch) => patchLearningSettings(patch),
    onMutate: async (patch) => {
      await cache.cancelQueries({ queryKey: key("settings") });
      const before = cache.getQueryData<LearningSettings>(key("settings"));
      if (before)
        cache.setQueryData<LearningSettings>(key("settings"), {
          ...before,
          ...patch,
        });
      return { before };
    },
    onError: (_error, _patch, context) => {
      if (context?.before) cache.setQueryData(key("settings"), context.before);
    },
    onSuccess: (next) => {
      cache.setQueryData(key("settings"), next);
      // Turning learning on can copy "What you use Timely for" into About you.
      void cache.invalidateQueries({ queryKey: key("memory") });
    },
  });
}

/** One chat's learning events, for the chips and cards under its replies. */
export function useChatLearning(conversationId: string, enabled: boolean) {
  return useQuery({
    queryKey: key("events", "chat", conversationId),
    queryFn: () => listLearningEvents({ conversationId, limit: 200 }),
    enabled: enabled && !!conversationId,
    staleTime: 10_000,
  });
}

/** The account's recent events, newest first (provenance and counts). */
export function useRecentLearning(enabled = true) {
  return useQuery({
    queryKey: key("events", "recent"),
    queryFn: () => listLearningEvents({ limit: 200 }),
    enabled,
    staleTime: 10_000,
  });
}

/** Changes waiting for Keep or Discard, from Timely's own events. */
export function useStagedLearning(enabled = true) {
  return useQuery({
    queryKey: key("events", "staged"),
    queryFn: () => listLearningEvents({ status: "staged", limit: 200 }),
    enabled,
    staleTime: 10_000,
  });
}

const PAGE = 30;

/** Activity: the account's feed, a page at a time. */
export function useLearningActivity() {
  return useInfiniteQuery({
    queryKey: key("events", "activity"),
    queryFn: ({ pageParam }) =>
      listLearningEvents({ before: pageParam || undefined, limit: PAGE }),
    initialPageParam: "",
    getNextPageParam: (last) =>
      last.length < PAGE ? undefined : last[last.length - 1].createdAt,
    staleTime: 10_000,
  });
}

function useLearningMutation<V, R>(fn: (vars: V) => Promise<R>) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => cache.invalidateQueries({ queryKey: learningKey }),
  });
}

export const useUndoLearning = () =>
  useLearningMutation((id: string) => undoLearningEvent(id));

export const useDecidePending = () =>
  useLearningMutation(
    ({ pendingId, choice }: { pendingId: string; choice: "keep" | "discard" }) =>
      decidePending(pendingId, choice),
  );

export function useLearnedSkills(enabled = true) {
  return useQuery({
    queryKey: key("skills"),
    queryFn: listLearnedSkills,
    enabled,
    staleTime: WORKER_STALE,
    retry: false,
  });
}

export function useLearnedSkill(name: string | null, entry?: string) {
  return useQuery({
    queryKey: key("skill", name ?? "", entry ?? ""),
    queryFn: () => getLearnedSkill(name ?? "", entry),
    enabled: !!name,
    staleTime: WORKER_STALE,
    retry: false,
  });
}

export const useEditSkill = () =>
  useLearningMutation(({ name, content }: { name: string; content: string }) =>
    editLearnedSkill(name, content),
  );

export const useSkillState = () =>
  useLearningMutation(({ name, state }: { name: string; state: SkillState }) =>
    setSkillState(name, state),
  );

export function useMemory(enabled = true) {
  return useQuery({
    queryKey: key("memory"),
    queryFn: getMemory,
    enabled,
    staleTime: WORKER_STALE,
    retry: false,
  });
}

export const useEditMemory = () =>
  useLearningMutation((edit: MemoryEdit) => editMemory(edit));

/** The worker's staged changes, for their diffs. */
export function usePending(enabled = true) {
  return useQuery({
    queryKey: key("pending"),
    queryFn: listPending,
    enabled,
    staleTime: WORKER_STALE,
    retry: false,
  });
}

export function useUpstream(enabled = true) {
  return useQuery({
    queryKey: key("upstream"),
    queryFn: listUpstream,
    enabled,
    staleTime: WORKER_STALE,
    retry: false,
  });
}

export function useUpstreamCompare(name: string | null) {
  return useQuery({
    queryKey: key("upstream", name ?? ""),
    queryFn: () => compareUpstream(name ?? ""),
    enabled: !!name,
    staleTime: WORKER_STALE,
    retry: false,
  });
}

export const useChooseUpstream = () =>
  useLearningMutation(
    ({ name, choice }: { name: string; choice: UpstreamChoice }) =>
      chooseUpstream(name, choice),
  );

export const webKeysKey = ["agent-web-keys"] as const;

/** Settings → Agent → Web search (Q-3.8). */
export function useWebKeys() {
  return useQuery({
    queryKey: webKeysKey,
    queryFn: getWebKeys,
    staleTime: 30_000,
  });
}

export function useSetWebKey() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ backend, key: value }: { backend: string; key: string }) =>
      setWebKey(backend, value),
    onSuccess: (next) => cache.setQueryData(webKeysKey, next),
  });
}

export function useRemoveWebKey() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: removeWebKey,
    onSuccess: (next) => cache.setQueryData(webKeysKey, next),
  });
}
