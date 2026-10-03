import { StageBoard } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

/** Loads a sample project and its tasks, as the project page's Stages tab does. */
function useProject(projectId: string) {
  const [data, setData] = useState<{ project: any; tasks: any[] } | null>(null);
  useEffect(() => {
    void Promise.all([
      fetch(`/api-proxy/projects/${projectId}`).then((r) => r.json()),
      fetch("/api-proxy/tasks").then((r) => r.json()),
    ]).then(([project, tasks]) =>
      setData({ project, tasks: tasks.filter((t: any) => (t.project?.id ?? t.projectId) === projectId) }),
    );
  }, [projectId]);
  return data;
}

export const OnboardingRedesign = () => {
  const data = useProject("prj_onboarding");
  return (
    <div className="bg-background p-6" style={{ width: 860 }}>
      {data && (
        <StageBoard
          projectId={data.project.id}
          workspaceId={data.project.workspaceId}
          stages={data.project.stages}
          tasks={data.tasks}
        />
      )}
    </div>
  );
};

export const EmptyLanes = () => {
  const data = useProject("prj_onboarding");
  return (
    <div className="bg-background p-6" style={{ width: 860 }}>
      {data && (
        <StageBoard projectId={data.project.id} workspaceId={data.project.workspaceId} stages={data.project.stages} tasks={[]} />
      )}
    </div>
  );
};

/** The board scrolls horizontally; this cell shows the later lanes. */
export const LaterStages = () => {
  const data = useProject("prj_onboarding");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = ref.current?.querySelector<HTMLElement>(".overflow-auto");
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [data]);
  return (
    <div ref={ref} className="bg-background p-6" style={{ width: 860 }}>
      {data && (
        <StageBoard
          projectId={data.project.id}
          workspaceId={data.project.workspaceId}
          stages={data.project.stages}
          tasks={data.tasks}
        />
      )}
    </div>
  );
};
