import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCustomField,
  createLabel,
  createStatus,
  createWorkspace,
  deleteCustomField,
  deleteLabel,
  deleteStatus,
  getConfig,
  getWorkspaces,
  updateCustomField,
  updateLabel,
  updateStatus,
  updateTaskViewsConfig,
  updateWorkspace,
  type CustomFieldPayload,
  type NamedColorPayload,
} from "@/app/utils/api/worksapce";

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: getWorkspaces,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 1000 * 60 * 5,
  });
}

export function useUpdateTaskViewsConfig() {
  return useMutation({
    mutationFn: updateTaskViewsConfig,
  });
}

function useInvalidateWorkspaces() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
      queryClient.invalidateQueries({ queryKey: ["config"] }),
    ]);
}

export function useCreateWorkspace() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: invalidate,
  });
}

export function useUpdateWorkspace() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: updateWorkspace,
    onSuccess: invalidate,
  });
}

export function useCreateStatus() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({
      workspaceId,
      ...data
    }: NamedColorPayload & { workspaceId: string }) =>
      createStatus(workspaceId, data),
    onSuccess: invalidate,
  });
}

export function useUpdateStatus() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({
      workspaceId,
      statusId,
      ...data
    }: NamedColorPayload & { workspaceId: string; statusId: string }) =>
      updateStatus(workspaceId, statusId, data),
    onSuccess: invalidate,
  });
}

export function useDeleteStatus() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({
      workspaceId,
      statusId,
    }: {
      workspaceId: string;
      statusId: string;
    }) => deleteStatus(workspaceId, statusId),
    onSuccess: invalidate,
  });
}

export function useCreateLabel() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({
      workspaceId,
      ...data
    }: NamedColorPayload & { workspaceId: string }) =>
      createLabel(workspaceId, data),
    onSuccess: invalidate,
  });
}

export function useUpdateLabel() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({
      workspaceId,
      labelId,
      ...data
    }: NamedColorPayload & { workspaceId: string; labelId: string }) =>
      updateLabel(workspaceId, labelId, data),
    onSuccess: invalidate,
  });
}

export function useDeleteLabel() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({
      workspaceId,
      labelId,
    }: {
      workspaceId: string;
      labelId: string;
    }) => deleteLabel(workspaceId, labelId),
    onSuccess: invalidate,
  });
}

export function useCreateCustomField() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({
      workspaceId,
      ...data
    }: CustomFieldPayload & { workspaceId: string }) =>
      createCustomField(workspaceId, data),
    onSuccess: invalidate,
  });
}

export function useUpdateCustomField() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({
      workspaceId,
      customFieldId,
      ...data
    }: CustomFieldPayload & { workspaceId: string; customFieldId: string }) =>
      updateCustomField(workspaceId, customFieldId, data),
    onSuccess: invalidate,
  });
}

export function useDeleteCustomField() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({
      workspaceId,
      customFieldId,
    }: {
      workspaceId: string;
      customFieldId: string;
    }) => deleteCustomField(workspaceId, customFieldId),
    onSuccess: invalidate,
  });
}
