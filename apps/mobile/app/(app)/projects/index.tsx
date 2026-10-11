import { useEffect, useState } from "react";
import { FolderKanban, Plus } from "lucide-react-native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import { DateField } from "../../../components/ui/DateTimeField";
import { Button, Field, SectionLabel, Select } from "../../../components/ui/primitives";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { useInvalidateAll, useProjectsQuery, useTasksQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { ProjectStartChoices, createProjectWithStart, useProjectStart } from "../../../components/projects/ProjectStart";
import type { CreateProjectPayload } from "../../../lib/api/projects";
import { resolvedColor } from "../../../lib/entityColor";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { formatShortDate, toDateInputValue } from "../../../lib/format";
import type { Project, Task } from "../../../lib/types";

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

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
  // Smart search's "Create project “X”" opens this screen with the title.
  const params = useLocalSearchParams<{ title?: string }>();
  const projects = projectsQ.data ?? [];
  const [title, setTitle] = useState(params.title ?? "");
  const [workspaceId, setWorkspaceId] = useState("");
  // Optional dates; with "Start from" a copied repeating series restarts on
  // the start date, as on web.
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  // The form stays folded behind the header's + until it is needed.
  const [creating, setCreating] = useState(Boolean(params.title));
  const chosenWorkspace = workspaceId || spaces[0]?.id || "";
  const start = useProjectStart(title, chosenWorkspace);
  const invalidate = useInvalidateAll();
  const create = useMutation({
    mutationFn: (payload: CreateProjectPayload) => createProjectWithStart(payload, start.suggestion, start.choices),
    onSuccess: () => invalidate(),
  });
  useEffect(() => {
    if (params.title) {
      setTitle(params.title);
      setCreating(true);
    }
  }, [params.title]);
  const visibleProjects = projects;
  const showForm = creating || (projectsQ.isSuccess && projects.length === 0);

  return (
    <Screen>
      <MobileHeader
        title="Projects"
        back
        subtitle={`${projects.length} total`}
        actions={
          <HeaderIconButton label={creating ? "Close new project" : "New project"} active={creating} onPress={() => setCreating((open) => !open)}>
            <Plus size={20} color={colors.foreground} />
          </HeaderIconButton>
        }
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
        {projectsQ.isError ? (
          <EmptyState icon={FolderKanban} title="Couldn't load projects" description="Check your connection and try again." />
        ) : (
          <>
            {showForm ? (
              <View style={[styles.card, styles.form]}>
                <SectionLabel compact>New project</SectionLabel>
                {spaces.length === 0 ? (
                  <Text style={styles.meta}>Create a workspace first, then add a project here.</Text>
                ) : (
                  <>
                    <Field label="Title" value={title} onChangeText={setTitle} placeholder="Project title" autoCapitalize="words" />
                    {spaces.length > 1 ? (
                      <Select
                        label="Workspace"
                        value={chosenWorkspace}
                        onChange={setWorkspaceId}
                        options={spaces.map((space) => ({ value: space.id, label: space.name }))}
                      />
                    ) : null}
                    <View style={styles.dates}>
                      <View style={{ flex: 1 }}>
                        <DateField
                          label="Start"
                          value={startDate ? new Date(`${startDate}T12:00:00`) : null}
                          onChange={(next) => setStartDate(next ? toDateInputValue(next) : "")}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <DateField
                          label="Deadline"
                          value={deadline ? new Date(`${deadline}T12:00:00`) : null}
                          onChange={(next) => setDeadline(next ? toDateInputValue(next) : "")}
                        />
                      </View>
                    </View>
                    <ProjectStartChoices suggestion={start.suggestion} choices={start.choices} onChange={start.setChoices} />
                    <Button
                      label="Create project"
                      size="lg"
                      stretch
                      loading={create.isPending}
                      disabled={!title.trim() || !chosenWorkspace}
                      onPress={() => {
                        create.mutate(
                          {
                            title: title.trim(),
                            workspaceId: chosenWorkspace,
                            ...(startDate ? { startDate } : {}),
                            ...(deadline ? { deadline } : {}),
                          },
                          {
                            onSuccess: (project) => {
                              setTitle("");
                              setStartDate("");
                              setDeadline("");
                              setCreating(false);
                              router.push(`/(app)/projects/${project.id}`);
                            },
                          },
                        );
                      }}
                    />
                    {create.error ? (
                      <Text style={styles.error}>{create.error instanceof Error ? create.error.message : "Could not create the project."}</Text>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}
            {visibleProjects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="Create a project to group tasks, stages, and deadlines."
              />
            ) : (
              visibleProjects.map((project) => {
                const stats = statsFor(project, tasks);
                return (
                  <AnimatedPressable
                    key={project.id}
                    onPress={() => router.push(`/(app)/projects/${project.id}`)}
                    style={[styles.card, { borderLeftWidth: 3, borderLeftColor: resolvedColor(project.color, project.id) }]}
                  >
                    <Text style={styles.title}>{project.title || "Untitled project"}</Text>
                    {project.status?.name || project.priorityLevel ? (
                      <Text style={styles.meta}>
                        {[project.status?.name, project.priorityLevel ? capitalize(project.priorityLevel) : ""].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
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
                      {project.deadline ? ` · Due ${formatShortDate(`${project.deadline.slice(0, 10)}T12:00:00`)}` : ""}
                    </Text>
                  </AnimatedPressable>
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    gap: 6,
  },
  title: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12 },
  error: { color: colors.destructive, fontSize: 12 },
  form: { gap: 12, padding: 16 },
  dates: { flexDirection: "row", gap: 10 },
  bar: { height: 6, borderRadius: 999, backgroundColor: colors.muted, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.primary },
}));
