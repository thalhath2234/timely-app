import { ColorChip } from "@timely/ui";

export const StatusChips = () => (
  <div className="flex flex-wrap items-center gap-2 p-4">
    <ColorChip color="#889096">Backlog</ColorChip>
    <ColorChip color="#0090FF">In progress</ColorChip>
    <ColorChip color="#FFB224">In review</ColorChip>
    <ColorChip color="#30A66D">Done</ColorChip>
  </div>
);

export const ProjectsWithoutDot = () => (
  <div className="flex flex-wrap items-center gap-2 p-4">
    <ColorChip color="#6E56CF" dot={false}>Website relaunch</ColorChip>
    <ColorChip color="#E93D82" dot={false}>Q4 research sprint</ColorChip>
    <ColorChip color="#12A594" dot={false}>Hiring: design lead</ColorChip>
  </div>
);

export const NoColor = () => (
  <div className="flex flex-wrap items-center gap-2 p-4">
    <ColorChip>No project</ColorChip>
    <ColorChip dot={false}>Unlabelled</ColorChip>
  </div>
);

export const TruncatedInRow = () => (
  <div className="w-[280px] p-4">
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <span className="truncate text-foreground">Draft onboarding flow</span>
      <ColorChip color="#3E63DD" className="max-w-28">Website relaunch</ColorChip>
    </div>
  </div>
);
