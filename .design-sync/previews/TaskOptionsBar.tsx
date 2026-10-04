import { TaskOptionsBar } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

const t = "2024-05-01T09:00:00Z";
const stage = (id: string, name: string, order: number, color: string, projectId: string) => ({
  id, name, order, color, projectId, createdAt: t, updatedAt: t,
});
const PROJECTS = [
  {
    id: "p1", title: "Website relaunch", description: null, color: "#3E63DD", workspaceId: "w1", createdAt: t, updatedAt: t,
    stages: [stage("st1", "Discovery", 0, "#889096", "p1"), stage("st2", "Design", 1, "#6E56CF", "p1"), stage("st3", "Build", 2, "#0090FF", "p1")],
  },
  { id: "p2", title: "Q4 research sprint", description: null, color: "#E93D82", workspaceId: "w1", createdAt: t, updatedAt: t, stages: [] },
];
const WORKSPACES = [
  {
    id: "w1", name: "Studio", color: "#6E56CF", userId: "u1", createdAt: t, updatedAt: t, status: [], customFields: [],
    lables: [
      { id: "l1", name: "Deep work", color: "#6E56CF", workspaceId: "w1", createdAt: t, updatedAt: t },
      { id: "l2", name: "Quick win", color: "#30A66D", workspaceId: "w1", createdAt: t, updatedAt: t },
    ],
  },
];

type Init = {
  overdue?: boolean;
  completed?: boolean;
  scheduled?: boolean;
  projectIds?: string[];
  priorities?: string[];
  labelIds?: string[];
  scope?: "global" | "project";
};

function Bar({ overdue = false, completed = false, scheduled = false, projectIds = [], priorities = [], labelIds = [], scope = "global" }: Init) {
  const [showCompleted, setShowCompleted] = useState(completed);
  const [onlyOverdue, setOnlyOverdue] = useState(overdue);
  const [onlyScheduled, setOnlyScheduled] = useState(scheduled);
  const [onlyRecurring, setOnlyRecurring] = useState(false);
  const [onlyDated, setOnlyDated] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState(projectIds);
  const [selectedPriorityLevels, setSelectedPriorityLevels] = useState(priorities);
  const [selectedLabelIds, setSelectedLabelIds] = useState(labelIds);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  return (
    <TaskOptionsBar
      showCompleted={showCompleted}
      setShowCompleted={setShowCompleted}
      onlyOverdue={onlyOverdue}
      setOnlyOverdue={setOnlyOverdue}
      onlyScheduled={onlyScheduled}
      setOnlyScheduled={setOnlyScheduled}
      onlyRecurring={onlyRecurring}
      setOnlyRecurring={setOnlyRecurring}
      onlyDated={onlyDated}
      setOnlyDated={setOnlyDated}
      projects={(scope === "project" ? PROJECTS.slice(0, 1) : PROJECTS) as any}
      workspaces={WORKSPACES as any}
      selectedProjectIds={selectedProjectIds}
      setSelectedProjectIds={setSelectedProjectIds}
      selectedPriorityLevels={selectedPriorityLevels}
      setSelectedPriorityLevels={setSelectedPriorityLevels}
      selectedLabelIds={selectedLabelIds}
      setSelectedLabelIds={setSelectedLabelIds}
      selectedStageIds={selectedStageIds}
      setSelectedStageIds={setSelectedStageIds}
      scope={scope}
    />
  );
}

export const AllTasks = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <Bar />
  </div>
);

export const FiltersActive = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <Bar overdue completed scheduled projectIds={["p1"]} priorities={["High", "Urgent"]} labelIds={["l1"]} />
  </div>
);

export const ProjectScope = () => (
  <div className="bg-background" style={{ width: "100%" }}>
    <Bar scope="project" />
  </div>
);

export const PriorityMenuOpen = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const details = ref.current?.querySelector("details");
    if (details) details.open = true;
  }, []);
  return (
    <div ref={ref} className="bg-background" style={{ width: "100%", height: 240 }}>
      <Bar priorities={["High"]} />
    </div>
  );
};
