import { EntityDetailPanel } from "@timely/ui";

// The panel renders through EntityModalShell (position: fixed, not portaled);
// the transform makes this frame its containing block, a desktop-sized box.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 1240, height: 1000, transform: "translateZ(0)" }}>{children}</div>
);

export const TaskDetail = () => (
  <Frame>
    <EntityDetailPanel kind="task" id="tsk_welcome_wireframes" onClose={() => {}} />
  </Frame>
);

export const ProjectDetail = () => (
  <Frame>
    <EntityDetailPanel kind="project" id="prj_onboarding" onClose={() => {}} />
  </Frame>
);

export const ReminderDetail = () => (
  <Frame>
    <EntityDetailPanel kind="task" id="tsk_weekly_update" onClose={() => {}} />
  </Frame>
);

export const Missing = () => (
  <Frame>
    <EntityDetailPanel kind="task" id="tsk_archived_long_ago" onClose={() => {}} />
  </Frame>
);
