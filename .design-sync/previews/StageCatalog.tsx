import { StageCatalog } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

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

function Catalog({ projectId, onLoaded }: { projectId: string; onLoaded?: (root: HTMLElement) => void }) {
  const data = useProject(projectId);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (data && ref.current && onLoaded) onLoaded(ref.current);
  }, [data]);
  return (
    <div ref={ref} className="bg-background p-6" style={{ width: 880 }}>
      {data && (
        <StageCatalog
          projectId={data.project.id}
          workspaceId={data.project.workspaceId}
          stages={data.project.stages}
          tasks={data.tasks}
          doesHaveStages={data.project.doesHaveStages}
        />
      )}
    </div>
  );
}

export const StagesEnabled = () => <Catalog projectId="prj_onboarding" />;

export const RenamingStage = () => (
  <Catalog
    projectId="prj_onboarding"
    onLoaded={(root) => root.querySelector<HTMLButtonElement>('button[title*="Rename"], button[aria-label*="Rename"]')?.click()}
  />
);

export const StagesOff = () => <Catalog projectId="prj_design_system" />;
