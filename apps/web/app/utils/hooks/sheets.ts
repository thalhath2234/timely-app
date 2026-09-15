import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreateSheetPayload,
  UpdateSheetPayload,
  createSheet,
  deleteSheet,
  duplicateSheet,
  getSheet,
  getSheets,
  updateSheet,
} from "@/app/utils/api/sheets";
import { Sheet } from "@/app/_types/types";

export const sheetsKey = ["sheets"] as const;
export const sheetKey = (id: string) => ["sheets", id] as const;

export function useSheets() {
  return useQuery({
    queryKey: sheetsKey,
    queryFn: getSheets,
  });
}

export function useSheet(id: string | undefined) {
  return useQuery({
    queryKey: sheetKey(id ?? ""),
    queryFn: () => getSheet(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateSheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateSheetPayload = {}) => createSheet(payload),
    onSuccess: (sheet) => {
      queryClient.setQueryData(sheetKey(sheet.id), sheet);
      queryClient.invalidateQueries({ queryKey: sheetsKey });
    },
  });
}

export function useUpdateSheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateSheetPayload & { id: string }) =>
      updateSheet(id, payload),
    onSuccess: (sheet) => {
      queryClient.setQueryData(sheetKey(sheet.id), sheet);
      queryClient.setQueryData<Sheet[]>(sheetsKey, (sheets) =>
        sheets?.map((item) => (item.id === sheet.id ? sheet : item)),
      );
    },
  });
}

export function useDeleteSheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteSheet(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: sheetKey(id) });
      queryClient.invalidateQueries({ queryKey: sheetsKey });
    },
  });
}

export function useDuplicateSheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => duplicateSheet(id),
    onSuccess: (sheet) => {
      queryClient.setQueryData(sheetKey(sheet.id), sheet);
      queryClient.invalidateQueries({ queryKey: sheetsKey });
    },
  });
}
