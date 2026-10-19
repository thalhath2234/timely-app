import { useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pencil, Trash2 } from "lucide-react-native";
import Screen from "../../../../components/ui/Screen";
import MobileHeader from "../../../../components/ui/MobileHeader";
import AnimatedPressable from "../../../../components/ui/AnimatedPressable";
import StarterLabels from "../../../../components/settings/StarterLabels";
import CleanupSuggestions from "../../../../components/settings/CleanupSuggestions";
import ConfirmSheet, { type ConfirmRequest } from "../../../../components/ui/ConfirmSheet";
import { ColorDot, GroupLabel, ListGroup, ListRow, Monogram, PreviewChip } from "../../../../components/settings/SettingsList";
import { CustomFieldsSheet, NameSheet, NamedColorSheet, fieldMeta } from "../../../../components/settings/WorkspaceSheets";
import { keys, useInvalidateAll, useProjectsQuery, useTasksQuery, useWorkspacesQuery } from "../../../../lib/hooks";
import {
  createCustomField,
  createLabel,
  createStatus,
  deleteCustomField,
  deleteWorkspace,
  deleteLabel,
  deleteStatus,
  updateCustomField,
  updateLabel,
  updateStatus,
  updateWorkspace,
} from "../../../../lib/api/workspaces";
import { createProject } from "../../../../lib/api/projects";
import { resolvedColor } from "../../../../lib/entityColor";
import { useToastStore } from "../../../../lib/toast";
import { colors, createThemedStyleSheet } from "../../../../lib/theme";

type Panel = "rename" | "statuses" | "labels" | "fields" | "project" | null;

const PREVIEW = 5;

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** A section of the workspace as one card: title, count and a preview of
 * its items as chips. Tapping it opens the sheet that manages them. */
function SummaryCard({
  title,
  count,
  empty,
  onPress,
  testID,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  onPress: () => void;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${count}. Manage`}
      onPress={onPress}
      style={styles.summary}
    >
      <View style={styles.summaryHead}>
        <Text style={styles.summaryTitle}>{title}</Text>
        <Text style={styles.summaryCount}>{count}</Text>
        <ChevronRight size={16} color={colors.mutedForeground} />
      </View>
      {count === 0 ? <Text style={styles.summaryEmpty}>{empty}</Text> : <View style={styles.chips}>{children}</View>}
    </AnimatedPressable>
  );
}

export default function WorkspaceEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const spaces = useWorkspacesQuery().data ?? [];
  const workspace = spaces.find((w) => w.id === id);
  const invalidateAll = useInvalidateAll();
  const projects = useProjectsQuery().data ?? [];
  const tasks = useTasksQuery().data ?? [];
  const [panel, setPanel] = useState<Panel>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function refresh() {
    await client.invalidateQueries({ queryKey: keys.workspaces });
  }

  if (!workspace) {
    return (
      <Screen>
        <MobileHeader title="Workspace" back large={false} />
        <Text style={{ color: colors.mutedForeground, padding: 16 }}>Workspace not found.</Text>
      </Screen>
    );
  }

  const workspaceId = workspace.id;
  const statuses = workspace.status ?? [];
  const labels = workspace.lables ?? [];
  const fields = workspace.customFields ?? [];
  const ownProjects = projects.filter((project) => project.workspaceId === workspaceId);
  const taskCount = tasks.filter((task) => task.workspaceId === workspaceId && !task.completedAt).length;
  const lastWorkspace = spaces.length <= 1;
  const more = (n: number) => (n > PREVIEW ? <PreviewChip key="__more" label={`+${n - PREVIEW}`} muted /> : null);

  return (
    <Screen>
      <MobileHeader title={workspace.name} back large={false} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
      >
        <AnimatedPressable
          testID="workspace-rename"
          accessibilityRole="button"
          accessibilityLabel={`Rename ${workspace.name}`}
          onPress={() => setPanel("rename")}
          style={styles.identity}
        >
          <Monogram name={workspace.name} color={resolvedColor(workspace.color, workspace.id)} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.name}>{workspace.name}</Text>
            <Text style={styles.meta}>
              {plural(ownProjects.length, "project")} · {plural(taskCount, "open task")}
            </Text>
          </View>
          <Pencil size={16} color={colors.mutedForeground} />
        </AnimatedPressable>

        <SummaryCard testID="workspace-statuses" title="Statuses" count={statuses.length} empty="No statuses yet. Add the columns your work moves through." onPress={() => setPanel("statuses")}>
          {statuses.slice(0, PREVIEW).map((status) => <PreviewChip key={status.id} label={status.name} color={status.color} />)}
          {more(statuses.length)}
        </SummaryCard>
        <SummaryCard testID="workspace-labels" title="Labels" count={labels.length} empty="No labels yet. Tag work across projects." onPress={() => setPanel("labels")}>
          {labels.slice(0, PREVIEW).map((label) => <PreviewChip key={label.id} label={label.name} color={label.color} />)}
          {more(labels.length)}
        </SummaryCard>
        <SummaryCard testID="workspace-fields" title="Custom fields" count={fields.length} empty="No custom fields. Add effort, client, budget…" onPress={() => setPanel("fields")}>
          {fields.slice(0, PREVIEW).map((field) => <PreviewChip key={field.id} label={`${field.name} · ${fieldMeta(field).split(" · ")[0]}`} />)}
          {more(fields.length)}
        </SummaryCard>

        <GroupLabel aside={ownProjects.length}>Projects</GroupLabel>
        <ListGroup testID="workspace-projects">
          {ownProjects.map((project) => {
            const status = project.status ?? statuses.find((item) => item.id === project.statusId);
            return (
              <ListRow
                key={project.id}
                title={project.title}
                leading={<ColorDot color={resolvedColor(project.color, project.id)} />}
                trailing={project.completedAt ? "Done" : status?.name ?? undefined}
                onPress={() => router.push(`/(app)/projects/${project.id}`)}
              />
            );
          })}
          <ListRow key="__new" tone="add" title="New project" onPress={() => setPanel("project")} testID="workspace-new-project" />
        </ListGroup>

        <ListGroup style={styles.danger}>
          <ListRow
            testID="workspace-delete"
            tone="danger"
            title={deleting ? "Deleting…" : "Delete workspace"}
            meta={lastWorkspace ? "Your last workspace cannot be deleted." : "Deletes its tasks, projects, docs, sheets, events and settings."}
            leading={<Trash2 size={18} color={colors.destructive} />}
            disabled={lastWorkspace || deleting}
            onPress={() =>
              setConfirm({
                title: `Delete ${workspace.name}?`,
                message: `All content in ${workspace.name} will be permanently deleted: tasks, projects, docs, sheets, events and settings. This cannot be undone.`,
                confirmLabel: "Delete",
                onConfirm: async () => {
                  setDeleting(true);
                  try {
                    await deleteWorkspace(workspace.id);
                    await invalidateAll();
                    router.replace("/(app)/settings/workspaces");
                  } catch (cause) {
                    setConfirm(null);
                    useToastStore.getState().show(cause instanceof Error ? cause.message : "Could not delete workspace");
                  } finally {
                    setDeleting(false);
                  }
                },
              })
            }
          />
        </ListGroup>
      </ScrollView>

      <NameSheet
        open={panel === "rename"}
        onClose={() => setPanel(null)}
        title="Rename workspace"
        label="Name"
        initial={workspace.name}
        placeholder="Workspace name"
        submitLabel="Save name"
        onSubmit={async (name) => {
          await updateWorkspace({ id: workspaceId, name });
          await refresh();
        }}
      />
      <NamedColorSheet
        open={panel === "statuses"}
        onClose={() => setPanel(null)}
        noun="status"
        title="Statuses"
        subtitle={workspace.name}
        items={statuses}
        hint="Statuses are the columns of this workspace's boards."
        top={(ask) => <CleanupSuggestions workspaceId={workspaceId} kind="status" confirm={ask} />}
        onCreate={async (data) => {
          await createStatus(workspaceId, data);
          await refresh();
        }}
        onUpdate={async (statusId, data) => {
          await updateStatus(workspaceId, statusId, data);
          await refresh();
        }}
        onDelete={async (statusId) => {
          await deleteStatus(workspaceId, statusId);
          await refresh();
        }}
      />
      <NamedColorSheet
        open={panel === "labels"}
        onClose={() => setPanel(null)}
        noun="label"
        title="Labels"
        subtitle={workspace.name}
        items={labels}
        top={(ask) => (
          <>
            <StarterLabels workspaceId={workspaceId} />
            <CleanupSuggestions workspaceId={workspaceId} kind="label" confirm={ask} />
          </>
        )}
        onCreate={async (data) => {
          await createLabel(workspaceId, data);
          await refresh();
        }}
        onUpdate={async (labelId, data) => {
          await updateLabel(workspaceId, labelId, data);
          await refresh();
        }}
        onDelete={async (labelId) => {
          await deleteLabel(workspaceId, labelId);
          await refresh();
        }}
      />
      <CustomFieldsSheet
        open={panel === "fields"}
        onClose={() => setPanel(null)}
        subtitle={workspace.name}
        fields={fields}
        top={(ask) => <CleanupSuggestions workspaceId={workspaceId} kind="option" confirm={ask} />}
        onCreate={async (data) => {
          await createCustomField(workspaceId, data);
          await refresh();
        }}
        onUpdate={async (fieldId, data) => {
          await updateCustomField(workspaceId, fieldId, data);
          await refresh();
        }}
        onDelete={async (fieldId) => {
          await deleteCustomField(workspaceId, fieldId);
          await refresh();
        }}
      />
      <NameSheet
        open={panel === "project"}
        onClose={() => setPanel(null)}
        title="New project"
        subtitle={workspace.name}
        label="Project name"
        placeholder="Website relaunch"
        submitLabel="Create project"
        onSubmit={async (title) => {
          const project = await createProject({ title, workspaceId });
          await client.invalidateQueries({ queryKey: keys.projects });
          router.push(`/(app)/projects/${project.id}`);
        }}
      />
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => confirm?.onConfirm()}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { padding: 16, paddingBottom: 40, gap: 10 },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  name: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  summary: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  summaryHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" },
  summaryCount: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  summaryEmpty: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  danger: { marginTop: 14 },
}));
