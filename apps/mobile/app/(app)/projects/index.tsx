import { useEffect, useState } from "react";
import { FolderKanban } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import { Field, PrimaryButton, SectionLabel, Select } from "../../../components/ui/primitives";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { useInvalidateAll, useProjectsQuery, useTasksQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { ProjectStartChoices, createProjectWithStart, useProjectStart } from "../../../components/projects/ProjectStart";
import type { CreateProjectPayload } from "../../../lib/api/projects";
import { resolvedColor } from "../../../lib/entityColor";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { formatShortDate, toDateInputValue } from "../../../lib/format";
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
  // Smart search's "Create project “X”" opens this screen with the title.
  const params = useLocalSearchParams<{ title?: string }>();
  const projects = projectsQ.data ?? [];
  const [title, setTitle] = useState(params.title ?? "");
  const [workspaceId, setWorkspaceId] = useState("");
  // Optional dates; with "Start from" a copied repeating series restarts on
  // the start date, as on web.
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [picker, setPicker] = useState<"start" | "deadline" | null>(null);
  const chosenWorkspace = workspaceId || spaces[0]?.id || "";
  const start = useProjectStart(title, chosenWorkspace);
  const invalidate = useInvalidateAll();
  const create = useMutation({
    mutationFn: (payload: CreateProjectPayload) => createProjectWithStart(payload, start.suggestion, start.choices),
    onSuccess: () => invalidate(),
  });
  useEffect(() => {
    if (params.title) setTitle(params.title);
  }, [params.title]);
  const visibleProjects = projects.filter((project) => !chosenWorkspace || project.workspaceId === chosenWorkspace);

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
                <View style={styles.dates}>
                  <Pressable accessibilityRole="button" onPress={() => setPicker("start")} style={[styles.card, styles.dateCard]}>
                    <Text style={styles.meta}>Start</Text>
                    <Text style={styles.dateValue}>{startDate ? formatShortDate(`${startDate}T12:00:00`) : "Pick a date"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setPicker("deadline")} style={[styles.card, styles.dateCard]}>
                    <Text style={styles.meta}>Deadline</Text>
                    <Text style={styles.dateValue}>{deadline ? formatShortDate(`${deadline}T12:00:00`) : "Pick a date"}</Text>
                  </Pressable>
                </View>
                <ProjectStartChoices suggestion={start.suggestion} choices={start.choices} onChange={start.setChoices} />
                <PrimaryButton
                  label="Create project"
                  disabled={!title.trim() || !chosenWorkspace || create.isPending}
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
                  </AnimatedPressable>
                );
              })
            )}
          </>
        )}
      </ScrollView>
      <DateTimeSheet
        open={picker !== null}
        value={(() => {
          const current = picker === "deadline" ? deadline : startDate;
          return current ? new Date(`${current}T12:00:00`) : new Date();
        })()}
        mode="date"
        title={picker === "deadline" ? "Deadline" : "Start"}
        onClose={() => setPicker(null)}
        onChange={(next) => {
          const value = next ? toDateInputValue(next) : "";
          if (picker === "deadline") setDeadline(value);
          else setStartDate(value);
          setPicker(null);
        }}
      />
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
  error: { color: colors.destructive, fontSize: 12 },
  dates: { flexDirection: "row", gap: 10 },
  dateCard: { flex: 1, paddingVertical: 10, gap: 2 },
  dateValue: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  bar: { height: 6, borderRadius: 999, backgroundColor: colors.muted, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.primary },
}));
