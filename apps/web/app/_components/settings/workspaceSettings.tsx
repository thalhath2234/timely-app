"use client";

import { FormEvent, useMemo, useState } from "react";
import Select from "@/app/_components/_ui/select";
import ColorPicker from "@/app/_components/_ui/colorPicker";
import CustomFieldEditor from "@/app/_components/settings/customFieldEditor";
import NamedColorEditor from "@/app/_components/settings/namedColorEditor";
import { Workspace } from "@/app/_types/types";
import { cn } from "@/app/utils/cn";
import {
  useCreateCustomField,
  useCreateLabel,
  useCreateStatus,
  useDeleteCustomField,
  useDeleteLabel,
  useDeleteStatus,
  useUpdateCustomField,
  useUpdateLabel,
  useUpdateStatus,
  useUpdateWorkspace,
  useWorkspaces,
} from "@/app/utils/hooks/workspaces";

type WorkspaceTab = "name" | "status" | "labels" | "customFields";

const WORKSPACE_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "status", label: "Status" },
  { id: "labels", label: "Labels" },
  { id: "customFields", label: "Custom fields" },
];

export default function WorkspaceSettings() {
  const { data: workspaces, isLoading } = useWorkspaces();
  const typedWorkspaces = useMemo(
    () => (workspaces ?? []) as Workspace[],
    [workspaces],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const workspaceId =
    selectedId && typedWorkspaces.some((item) => item.id === selectedId)
      ? selectedId
      : (typedWorkspaces[0]?.id ?? "");

  const workspace = typedWorkspaces.find((item) => item.id === workspaceId);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading workspaces…</p>
    );
  }

  if (!typedWorkspaces.length) {
    return (
      <div className="max-w-lg">
        <h2 className="text-base font-semibold text-foreground">Workspaces</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You don’t have any workspaces yet. Create one from the sidebar + menu.
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Workspaces</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure statuses, labels, and custom fields separately for each
          workspace.
        </p>
      </div>

      <label className="flex max-w-sm flex-col gap-1">
        <span className="text-xs text-muted-foreground">Workspace</span>
        <Select
          value={workspaceId}
          onChange={setSelectedId}
          options={typedWorkspaces.map((item) => ({
            value: item.id,
            label: item.name,
            color: item.color ?? undefined,
          }))}
        />
      </label>

      {workspace && (
        <WorkspaceEditor key={workspace.id} workspace={workspace} />
      )}
    </div>
  );
}

function WorkspaceEditor({ workspace }: { workspace: Workspace }) {
  const [tab, setTab] = useState<WorkspaceTab>("name");
  const [name, setName] = useState(workspace.name);
  const [color, setColor] = useState(workspace.color || "#6E56CF");
  const [renameMessage, setRenameMessage] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const updateWorkspace = useUpdateWorkspace();
  const createStatus = useCreateStatus();
  const updateStatus = useUpdateStatus();
  const deleteStatus = useDeleteStatus();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();
  const createCustomField = useCreateCustomField();
  const updateCustomField = useUpdateCustomField();
  const deleteCustomField = useDeleteCustomField();

  const onRename = async (event: FormEvent) => {
    event.preventDefault();
    setRenameMessage(null);
    setRenameError(null);

    try {
      await updateWorkspace.mutateAsync({
        id: workspace.id,
        name: name.trim(),
        color,
      });
      setRenameMessage("Workspace name saved.");
    } catch (err) {
      setRenameError(
        err instanceof Error ? err.message : "Could not rename workspace.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b border-border pb-px">
        {WORKSPACE_TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "-mb-px cursor-pointer rounded-t-lg border-b-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="pt-1">
        {tab === "name" && (
          <form onSubmit={onRename} className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">
                Workspace name
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Rename this workspace and pick a color so tasks from different
                workspaces are easy to scan.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ColorPicker
                value={color}
                onChange={setColor}
                aria-label="Workspace color"
              />
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-border bg-input/30 px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
              />
              <button
                type="submit"
                disabled={updateWorkspace.isPending}
                className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {updateWorkspace.isPending ? "Saving…" : "Save"}
              </button>
            </div>
            {renameError && (
              <p className="text-xs text-destructive">{renameError}</p>
            )}
            {renameMessage && (
              <p className="text-xs text-success">{renameMessage}</p>
            )}
          </form>
        )}

        {tab === "status" && (
          <NamedColorEditor
            title="Statuses"
            description="Statuses used by tasks and projects in this workspace."
            emptyLabel="No statuses yet."
            items={(workspace.status ?? []).map((status) => ({
              id: status.id,
              name: status.name,
              color: status.color,
              badge: status.isDefault ? "Default" : undefined,
            }))}
            onCreate={async (item) => {
              await createStatus.mutateAsync({
                workspaceId: workspace.id,
                ...item,
              });
            }}
            onUpdate={async (statusId, item) => {
              await updateStatus.mutateAsync({
                workspaceId: workspace.id,
                statusId,
                ...item,
              });
            }}
            onDelete={async (statusId) => {
              await deleteStatus.mutateAsync({
                workspaceId: workspace.id,
                statusId,
              });
            }}
          />
        )}

        {tab === "labels" && (
          <NamedColorEditor
            title="Labels"
            description="Reusable color labels you can attach to tasks."
            emptyLabel="No labels yet."
            items={(workspace.lables ?? []).map((label) => ({
              id: label.id,
              name: label.name,
              color: label.color,
            }))}
            onCreate={async (item) => {
              await createLabel.mutateAsync({
                workspaceId: workspace.id,
                ...item,
              });
            }}
            onUpdate={async (labelId, item) => {
              await updateLabel.mutateAsync({
                workspaceId: workspace.id,
                labelId,
                ...item,
              });
            }}
            onDelete={async (labelId) => {
              await deleteLabel.mutateAsync({
                workspaceId: workspace.id,
                labelId,
              });
            }}
          />
        )}

        {tab === "customFields" && (
          <CustomFieldEditor
            fields={workspace.customFields ?? []}
            onCreate={async (payload) => {
              await createCustomField.mutateAsync({
                workspaceId: workspace.id,
                ...payload,
              });
            }}
            onUpdate={async (customFieldId, payload) => {
              await updateCustomField.mutateAsync({
                workspaceId: workspace.id,
                customFieldId,
                ...payload,
              });
            }}
            onDelete={async (customFieldId) => {
              await deleteCustomField.mutateAsync({
                workspaceId: workspace.id,
                customFieldId,
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
