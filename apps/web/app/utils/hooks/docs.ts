import { useEffect, useRef, type MutableRefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreateDocPayload,
  DocWatchEvent,
  UpdateDocPayload,
  createDoc,
  deleteDoc,
  getDoc,
  getDocs,
  updateDoc,
  watchDoc,
} from "@/app/utils/api/docs";
import { Doc } from "@/app/_types/types";

export const docsKey = ["docs"] as const;
export const docKey = (id: string) => ["docs", id] as const;

export function useDocs() {
  return useQuery({
    queryKey: docsKey,
    queryFn: getDocs,
  });
}

export function useDoc(id: string | undefined) {
  return useQuery({
    queryKey: docKey(id ?? ""),
    queryFn: () => getDoc(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateDocPayload = {}) => createDoc(payload),
    onSuccess: (doc) => {
      queryClient.setQueryData(docKey(doc.id), doc);
      queryClient.invalidateQueries({ queryKey: docsKey });
    },
  });
}

export function useUpdateDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateDocPayload & { id: string }) =>
      updateDoc(id, payload),
    // Autosave fires often, so the caches are patched in place instead of
    // triggering a refetch of every doc on each save.
    onSuccess: (doc) => {
      queryClient.setQueryData(docKey(doc.id), doc);
      queryClient.setQueryData<Doc[]>(docsKey, (docs) =>
        docs?.map((item) => (item.id === doc.id ? doc : item)),
      );
    },
  });
}

export function useDeleteDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteDoc(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: docKey(id) });
      queryClient.invalidateQueries({ queryKey: docsKey });
    },
  });
}

/** Subscribe to GET /docs/:id/watch. Skips echoes of our own save and dirty editors. */
export function useDocWatch(
  id: string | undefined,
  options: {
    enabled?: boolean;
    lastSavedAtRef: MutableRefObject<string | null>;
    hasLocalEdits: () => boolean;
    onRemote?: () => void;
    onDeleted?: () => void;
  },
) {
  const queryClient = useQueryClient();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!id || options.enabled === false) return;

    return watchDoc(id, (event: DocWatchEvent) => {
      const current = optionsRef.current;
      if (event.type === "hello") return;
      if (event.type === "deleted") {
        queryClient.removeQueries({ queryKey: docKey(id) });
        queryClient.invalidateQueries({ queryKey: docsKey });
        current.onDeleted?.();
        return;
      }
      if (event.type !== "updated") return;
      if (event.updatedAt && event.updatedAt === current.lastSavedAtRef.current) {
        return;
      }
      if (current.hasLocalEdits()) return;
      if (event.document) {
        queryClient.setQueryData(docKey(id), event.document);
        queryClient.setQueryData<Doc[]>(docsKey, (docs) =>
          docs?.map((item) => (item.id === id ? (event.document as Doc) : item)),
        );
      } else {
        queryClient.invalidateQueries({ queryKey: docKey(id) });
      }
      queryClient.invalidateQueries({ queryKey: docsKey });
      if (event.updatedAt) current.lastSavedAtRef.current = event.updatedAt;
      current.onRemote?.();
    });
  }, [id, options.enabled, queryClient]);
}
