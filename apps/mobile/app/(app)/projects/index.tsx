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
import { useInvalidateAll, useProjectsQuery, useTasksQuery, useWorkspacesQuery } from "../../../lib/hooks";
import { ProjectStartChoices, createProjectWithStart, useProjectStart } from "../../../components/projects/ProjectStart";
import type { CreateProjectPayload } from "../../../lib/api/projects";
import { resolvedColor } from "../../../lib/entityColor";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { formatShortDate, toDateInputValue } from "../../../lib/format";
import type { Project, Task } from "../../../lib/types";
import { FocusGroupScrollView } from "../../../components/ui/FocusGroup";

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
              <ListGroup testID="projects-list">
                {visibleProjects.map((project) => {
                  const stats = statsFor(project, tasks);
                  const color = resolvedColor(project.color, project.id);
                  const share = stats.total ? stats.completed / stats.total : 0;
                  const meta = [
                    `${stats.open} open`,
                    project.deadline ? `Due ${formatShortDate(`${project.deadline.slice(0, 10)}T12:00:00`)}` : "",
                    project.status?.name ?? "",
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <ListRow
                      key={project.id}
                      title={project.title || "Untitled project"}
                      meta={meta}
                      leading={<View style={[styles.tint, { backgroundColor: color }]} />}
                      trailing={
                        <View style={styles.progress}>
                          <View style={styles.bar}>
                            <View style={[styles.fill, { width: `${Math.round(share * 100)}%`, backgroundColor: color }]} />
                          </View>
                          <Text style={styles.count}>
                            {stats.completed}/{stats.total}
                          </Text>
                        </View>
                      }
                      onPress={() => router.push(`/(app)/projects/${project.id}`)}
                    />
                  );
                })}
              </ListGroup>
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
  error: { color: colors.destructive, fontSize: 12 },
  sheetBody: { gap: 10, paddingBottom: 4 },
  titleCard: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingVertical: 12 },
  tint: { width: 3, height: 28, borderRadius: 2 },
  progress: { alignItems: "flex-end", gap: 4, marginRight: 2 },
  bar: { width: 56, height: 4, borderRadius: 999, backgroundColor: colors.muted, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999 },
  count: { color: colors.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] },
}));
