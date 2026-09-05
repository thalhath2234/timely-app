import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreateDocPayload,
  UpdateDocPayload,
  createDoc,
  deleteDoc,
  getDoc,
  getDocs,
  updateDoc,
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
