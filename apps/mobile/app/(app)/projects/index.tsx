import { useEffect, useState } from "react";
import { FolderKanban, Plus } from "lucide-react-native";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import { ListGroup, ListRow } from "../../../components/settings/SettingsList";
import { Field, PrimaryButton } from "../../../components/ui/primitives";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { useInvalidateAll, useProjectsQuery, useTasksQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { ProjectStartChoices, createProjectWithStart, useProjectStart } from "../../../components/projects/ProjectStart";
import type { CreateProjectPayload } from "../../../lib/api/projects";
import { resolvedColor } from "../../../lib/entityColor";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { formatShortDate, toDateInputValue } from "../../../lib/format";
import type { Project, Task } from "../../../lib/types";
import { FocusGroupScrollView } from "../../../components/ui/FocusGroup";

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
  const [picking, setPicking] = useState<"workspace" | "start" | "deadline" | null>(null);
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

  return (
    <Screen>
      <MobileHeader
        title="Projects"
        back
        subtitle={`${projects.length} total`}
        actions={
          <HeaderIconButton label="New project" active={creating} onPress={() => setCreating(true)}>
            <Plus size={20} color={colors.foreground} />
          </HeaderIconButton>
        }
      />
      <FocusGroupScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
        {projectsQ.isError ? (
          <EmptyState icon={FolderKanban} title="Couldn't load projects" description="Check your connection and try again." />
        ) : (
          <>
            {visibleProjects.length === 0 ? (
              <>
                <EmptyState
                  icon={FolderKanban}
                  title="No projects yet"
                  description={spaces.length ? "Create a project to group tasks, stages, and deadlines." : "Create a workspace first, then add a project here."}
                />
                {spaces.length ? (
                  <ListGroup>
                    <ListRow tone="add" title="New project" testID="projects-new" onPress={() => setCreating(true)} />
                  </ListGroup>
                ) : null}
              </>
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
      </FocusGroupScrollView>
      <BottomSheet
        open={creating}
        onClose={() => setCreating(false)}
        title="New project"
        subtitle={spaces.find((space) => space.id === chosenWorkspace)?.name}
        footer={
          <PrimaryButton
            label={create.isPending ? "Creating…" : "Create project"}
            loading={create.isPending}
            disabled={!title.trim() || !chosenWorkspace}
            testID="project-create"
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
        }
      >
        <View style={styles.sheetBody}>
          <View style={styles.titleCard}>
            <Field bare large value={title} onChangeText={setTitle} placeholder="Project title" autoCapitalize="words" autoFocus={!title} />
          </View>
          <ListGroup>
            <ListRow
              title="Workspace"
              trailing={spaces.find((space) => space.id === chosenWorkspace)?.name ?? "None"}
              onPress={spaces.length > 1 ? () => setPicking("workspace") : undefined}
            />
            <ListRow
              title="Start date"
              trailing={startDate ? formatShortDate(`${startDate}T12:00:00`) : "None"}
              onPress={() => setPicking("start")}
            />
            <ListRow
              title="Deadline"
              trailing={deadline ? formatShortDate(`${deadline}T12:00:00`) : "None"}
              onPress={() => setPicking("deadline")}
            />
          </ListGroup>
          <ProjectStartChoices suggestion={start.suggestion} choices={start.choices} onChange={start.setChoices} />
          {create.error ? (
            <Text style={styles.error}>{create.error instanceof Error ? create.error.message : "Could not create the project."}</Text>
          ) : null}
        </View>
        <BottomSheet open={picking === "workspace"} onClose={() => setPicking(null)} title="Workspace">
          {spaces.map((space) => (
            <SheetOption
              key={space.id}
              selected={space.id === chosenWorkspace}
              onSelect={() => {
                setWorkspaceId(space.id);
                setPicking(null);
              }}
            >
              {space.name}
            </SheetOption>
          ))}
        </BottomSheet>
        <DateTimeSheet
          open={picking === "start" || picking === "deadline"}
          mode="date"
          title={picking === "deadline" ? "Deadline" : "Start date"}
          value={(() => {
            const day = picking === "deadline" ? deadline : startDate;
            return day ? new Date(`${day}T12:00:00`) : null;
          })()}
          onClose={() => setPicking(null)}
          onChange={(next) => {
            const day = next ? toDateInputValue(next) : "";
            if (picking === "deadline") setDeadline(day);
            else setStartDate(day);
          }}
        />
      </BottomSheet>
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
  sheetBody: { gap: 10, paddingBottom: 4 },
  titleCard: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingVertical: 12 },
  bar: { height: 6, borderRadius: 999, backgroundColor: colors.muted, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.primary },
}));
