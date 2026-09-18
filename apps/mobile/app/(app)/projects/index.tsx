import { useState } from "react";
import { FolderKanban } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import { Field, PrimaryButton, SectionLabel, Select } from "../../../components/ui/primitives";
import { useCreateProject, useProjectsQuery, useTasksQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { resolvedColor } from "../../../lib/entityColor";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import type { Project, Task } from "../../../lib/types";

function statsFor(project: Project, tasks: Task[]) {
  const scoped = tasks.filter((task) => task.projectId === project.id && (task.duration ?? 0) > 0);
  const completed = scoped.filter((task) => task.completedAt).length;
  return { total: scoped.length, open: scoped.length - completed, completed };
}

export default function ProjectsScreen() {
  const router = useRouter();
  const projectsQ = useProjectsQuery();
  const spaces = useWorkspacesQuery().data ?? [];
  const tasks = useTasksQuery().data ?? [];
  const create = useCreateProject();
  const projects = projectsQ.data ?? [];
  const [title, setTitle] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const chosenWorkspace = workspaceId || spaces[0]?.id || "";

  return (
    <Screen>
      <MobileHeader title="Projects" back large={false} subtitle={`${projects.length} total`} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
        {projectsQ.isError ? (
          <EmptyState icon={FolderKanban} title="Couldn't load projects" description="Check your connection and try again." />
        ) : (
          <>
            <SectionLabel>New project</SectionLabel>
            {spaces.length === 0 ? (
              <Text style={styles.meta}>Create a workspace first, then add a project here.</Text>
            ) : (
              <>
                {spaces.length > 1 ? (
                  <Select
                    value={chosenWorkspace}
                    onChange={setWorkspaceId}
                    placeholder="Workspace"
                    options={spaces.map((space) => ({ value: space.id, label: space.name }))}
                  />
                ) : null}
                <Field value={title} onChangeText={setTitle} placeholder="Project title" autoCapitalize="words" />
                <PrimaryButton
                  label="Create project"
                  disabled={!title.trim() || !chosenWorkspace || create.isPending}
                  onPress={() => {
                    create.mutate(
                      { title: title.trim(), workspaceId: chosenWorkspace },
                      {
                        onSuccess: (project) => {
                          setTitle("");
                          router.push(`/(app)/projects/${project.id}`);
                        },
                      },
                    );
                  }}
                />
              </>
            )}
            {projects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="Create a project to group tasks, stages, and deadlines."
              />
            ) : (
              projects.map((project) => {
                const stats = statsFor(project, tasks);
                return (
                  <Pressable
                    key={project.id}
                    onPress={() => router.push(`/(app)/projects/${project.id}`)}
                    style={[styles.card, { borderLeftWidth: 3, borderLeftColor: resolvedColor(project.color, project.id) }]}
                  >
                    <Text style={styles.title}>{project.title || "Untitled project"}</Text>
                    <Text style={styles.meta}>
                      {project.status?.name || "No status"}
                      {project.priorityLevel ? ` · ${project.priorityLevel}` : ""}
                    </Text>
                    <View style={styles.bar}>
                      <View
                        style={[
                          styles.fill,
                          { width: `${stats.total ? Math.round((stats.completed / stats.total) * 100) : 0}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.meta}>
                      {stats.open} open · {stats.completed}/{stats.total} done
                      {project.startDate || project.deadline
                        ? ` · ${project.startDate || "—"} → ${project.deadline || "—"}`
                        : ""}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    gap: 6,
  },
  title: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12 },
  bar: { height: 6, borderRadius: 999, backgroundColor: colors.muted, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.primary },
}));
