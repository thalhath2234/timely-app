"use client";

import { useMemo } from "react";
import { CalendarClock, Clock, Layers } from "lucide-react";
import { RailEmpty, RailRow, RailRows, RailSection, RailStat } from "@/app/_components/_ui/pageWithRail";
import { useCalendarRange } from "@/app/utils/hooks/calendar";
import { formatDuration } from "@/app/utils/calendar";
import { resolvedColor } from "@/app/utils/entityColor";
import { formatShortDate } from "@/app/utils/projectStats";
import type { Project } from "@/app/_types/types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows a card lists before it stops; the page itself has the rest. */
const ROWS = 6;

/** The Projects page rail: time planned per project over the next seven
 * days, deadlines that are near or past, and projects by status. */
export default function ProjectsRail({ projects }: { projects: Project[] }) {
  const [from, to] = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 7 * DAY_MS);
    return [start, end];
  }, []);
  const range = useCalendarRange(from, to);

  const planned = useMemo(() => {
    const minutes = new Map<string, number>();
    for (const item of range.data?.items ?? []) {
      if (item.allDay || (item.kind !== "task" && item.kind !== "taskOccurrence")) continue;
      const projectId = item.task?.projectId ?? item.task?.project?.id;
      if (!projectId) continue;
      const length = Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000);
      if (length > 0) minutes.set(projectId, (minutes.get(projectId) ?? 0) + length);
    }
    const rows = projects
      .map((project) => ({ project, minutes: minutes.get(project.id) ?? 0 }))
      .filter((row) => row.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);
    const total = rows.reduce((sum, row) => sum + row.minutes, 0);
    return { rows, total, max: rows[0]?.minutes ?? 0 };
  }, [range.data, projects]);

  // The nearest deadlines, overdue first; a day count says how near.
  const due = useMemo(() => {
    const today = from.getTime();
    return projects
      .filter((project) => project.deadline)
      .map((project) => ({ project, at: new Date(project.deadline as string).getTime() }))
      .filter((row) => !Number.isNaN(row.at))
      .sort((a, b) => a.at - b.at)
      .slice(0, ROWS)
      .map((row) => ({ ...row, days: Math.round((row.at - today) / DAY_MS) }));
  }, [projects, from]);

  // Only once statuses are in use; "5 with no status" says nothing.
  const byStatus = useMemo(() => {
    if (!projects.some((project) => project.status)) return [];
    const counts = new Map<string, { name: string; color: string | null; count: number }>();
    for (const project of projects) {
      const key = project.status?.id ?? "none";
      const entry = counts.get(key) ?? { name: project.status?.name ?? "No status", color: project.status?.color ?? null, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [projects]);

  return (
    <>
      <RailSection
        title="Next 7 days"
        icon={<Clock className="size-3.5 text-primary" />}
        meta={planned.total > 0 ? "planned" : undefined}
        data-testid="projects-planned"
      >
        {range.isLoading ? (
          <RailEmpty>Reading the calendar…</RailEmpty>
        ) : planned.rows.length === 0 ? (
          <RailEmpty>No project work on the calendar yet. Schedule tasks from the Tasks or Calendar page.</RailEmpty>
        ) : (
          <>
            <div className="mb-3">
              <RailStat value={formatDuration(planned.total)} label={`across ${planned.rows.length} project${planned.rows.length === 1 ? "" : "s"}`} />
            </div>
            <RailRows>
              {planned.rows.slice(0, ROWS).map(({ project, minutes }) => (
                <RailRow
                  key={project.id}
                  href={`/projects/${project.id}`}
                  label={project.title || "Untitled project"}
                  color={resolvedColor(project.color, project.id)}
                  share={planned.max > 0 ? minutes / planned.max : 0}
                  value={formatDuration(minutes)}
                />
              ))}
            </RailRows>
          </>
        )}
      </RailSection>

      <RailSection title="Deadlines" icon={<CalendarClock className="size-3.5 text-warning" />} data-testid="projects-due">
        {due.length === 0 ? (
          <RailEmpty>No project has a deadline yet. Set one in the project details.</RailEmpty>
        ) : (
          <RailRows>
            {due.map(({ project, days }) => (
              <RailRow
                key={project.id}
                href={`/projects/${project.id}`}
                label={project.title || "Untitled project"}
                meta={days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue` : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`}
                color={resolvedColor(project.color, project.id)}
                tone={days < 0 ? "danger" : days <= 7 ? "primary" : "default"}
                value={formatShortDate(project.deadline)}
              />
            ))}
          </RailRows>
        )}
      </RailSection>

      {byStatus.length > 0 ? (
        <RailSection title="By status" icon={<Layers className="size-3.5 text-muted-foreground" />} data-testid="projects-status">
          <RailRows>
            {byStatus.map((entry) => (
              <RailRow key={entry.name} label={entry.name} color={entry.color} value={entry.count} />
            ))}
          </RailRows>
        </RailSection>
      ) : null}
    </>
  );
}
