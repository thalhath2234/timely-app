import { ProjectTaskList, sampleApi } from "@timely/ui";
import { useEffect, useRef } from "react";

// Reads the same sample workspace TimelyProvider serves, so rows passed as
// props match what the mocked API returns to the component's own queries.
let api: any = null;
function get<T = any>(route: string, params: Record<string, string> = {}, query = ""): T {
  api ??= sampleApi();
  return api[route]({ method: "GET", path: "", params, query: new URLSearchParams(query), body: undefined });
}

function List({ projectId, view }: { projectId: string; view?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const project = get<any>("GET /projects/:id", { id: projectId });
  const workspace = get<any[]>("GET /workspaces").find((w) => w.id === project.workspaceId);
  useEffect(() => {
    if (!view) return;
    // Switch the view the way a person would: click its toggle once the toolbar mounts.
    const timer = setInterval(() => {
      const button = Array.from(ref.current?.querySelectorAll("button") ?? []).find(
        (b) => b.textContent?.trim() === view || b.getAttribute("aria-label") === view || b.title === view,
      );
      if (button) {
        button.click();
        clearInterval(timer);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [view]);
  return (
    <div ref={ref} className="flex flex-col bg-background" style={{ width: 1180, height: 720 }}>
      <ProjectTaskList project={project} workspace={workspace} />
    </div>
  );
}

export const OnboardingStages = () => <List projectId="prj_onboarding" />;

export const DesignSystemKanban = () => <List projectId="prj_design_system" view="Kanban" />;

export const DesignSystemByStatus = () => <List projectId="prj_design_system" />;
