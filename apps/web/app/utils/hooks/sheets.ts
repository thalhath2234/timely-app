import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreateSheetPayload,
  UpdateSheetPayload,
  createSheet,
  createSheetTemplate,
  deleteSheet,
  deleteSheetTemplate,
  duplicateSheet,
  getSheet,
  getSheets,
  getSheetTemplates,
  materializeTemplateTab,
  updateSheet,
  updateSheetTemplate,
} from "@/app/utils/api/sheets";
import { Sheet, SheetTemplate } from "@/app/_types/types";

export const sheetsKey = ["sheets"] as const;
export const sheetKey = (id: string) => ["sheets", id] as const;
export const sheetTemplatesKey = ["sheet-templates"] as const;

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

export function useSheetTemplates() {
  return useQuery({
    queryKey: sheetTemplatesKey,
    queryFn: getSheetTemplates,
  });
}

export function useCreateSheetTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { sheetId: string; name?: string; tabId?: string }) =>
      createSheetTemplate(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sheetTemplatesKey });
    },
  });
}

export function useUpdateSheetTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateSheetTemplate(id, { name }),
    onSuccess: (template) => {
      queryClient.setQueryData<SheetTemplate[]>(sheetTemplatesKey, (list) =>
        list?.map((item) => (item.id === template.id ? template : item)),
      );
    },
  });
}

export function useDeleteSheetTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteSheetTemplate(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<SheetTemplate[]>(sheetTemplatesKey, (list) =>
        list?.filter((item) => item.id !== id),
      );
    },
  });
}

export function useMaterializeTemplateTab() {
  return useMutation({
    mutationFn: ({ templateId, tabId }: { templateId: string; tabId?: string }) =>
      materializeTemplateTab(templateId, tabId),
  });
}
