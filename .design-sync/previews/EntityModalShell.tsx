import {
  ColorPicker, DatePicker, EntityModalShell, LabelPicker, ModalMain, ModalSidebar, PropertyRow, RecurrenceEditor,
  SaveStatusBadge, Select, SidebarSectionTitle, TaskTypeToggle,
} from "@timely/ui";
import {
  CalendarDays, Check, Circle, Clock, Cloud, Copy, Flag, FolderKanban, GitBranch, Link2, ListTodo, Plus, Repeat, Trash2,
} from "lucide-react";
import { useState } from "react";

const titleClass =
  "w-full bg-transparent text-3xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50";
const selectClass = "border-0 bg-transparent px-0 shadow-none";
const iconButton =
  "inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground transition-colors hover:border-border hover:text-foreground";
const t = "2024-05-01T09:00:00Z";
const LABELS = [
  { id: "l1", name: "Deep work", color: "#6E56CF", workspaceId: "w1", createdAt: t, updatedAt: t },
  { id: "l2", name: "Meeting prep", color: "#0090FF", workspaceId: "w1", createdAt: t, updatedAt: t },
  { id: "l3", name: "Quick win", color: "#30A66D", workspaceId: "w1", createdAt: t, updatedAt: t },
];
const PRIORITY = [
  { value: "Low", label: "Low", color: "#30A66D" },
  { value: "Medium", label: "Medium", color: "#FFB224" },
  { value: "High", label: "High", color: "#F76808" },
  { value: "Urgent", label: "Urgent", color: "#E5484D" },
];
const anchor = new Date(2024, 4, 16, 9, 0);

// The shell is position:fixed; the transform makes this frame its containing
// block so the modal and scrim fill a desktop-sized box rather than the cell.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 1240, height: 1000, transform: "translateZ(0)" }}>{children}</div>
);

function CreateButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
    >
      <Plus className="size-4" />
      {label}
    </button>
  );
}

function Description({ text }: { text: string }) {
  return (
    <div className="mt-4 flex h-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border">
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-3 text-sm text-foreground">
        {text.split("\n").map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

function TaskSidebar({ withLabels = true }: { withLabels?: boolean }) {
  const [kind, setKind] = useState<"task" | "reminder">("task");
  const [workspace, setWorkspace] = useState("w1");
  const [project, setProject] = useState("p1");
  const [stage, setStage] = useState("st2");
  const [status, setStatus] = useState("s2");
  const [priority, setPriority] = useState("High");
  const [start, setStart] = useState("2024-05-16");
  const [deadline, setDeadline] = useState("2024-05-24");
  const [repeat, setRepeat] = useState<any>(null);
  const [labels, setLabels] = useState(["l1"]);
  return (
    <ModalSidebar>
      <div className="flex flex-col gap-1">
        <div className="px-1 py-1.5">
          <TaskTypeToggle value={kind} onChange={setKind} />
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            Estimated minutes of work the scheduler can place.
          </p>
        </div>
        <PropertyRow icon={FolderKanban} label="Workspace">
          <Select size="sm" value={workspace} onChange={setWorkspace} className={selectClass}
            options={[{ value: "w1", label: "Studio", color: "#6E56CF" }, { value: "w2", label: "Personal", color: "#12A594" }]} />
        </PropertyRow>
        <PropertyRow icon={ListTodo} label="Project">
          <Select size="sm" value={project} onChange={setProject} className={selectClass}
            options={[{ value: "", label: "No project" }, { value: "p1", label: "Website relaunch", color: "#3E63DD" }]} />
        </PropertyRow>
        <PropertyRow icon={GitBranch} label="Stage">
          <Select size="sm" value={stage} onChange={setStage} className={selectClass}
            options={[{ value: "st1", label: "Discovery", color: "#889096" }, { value: "st2", label: "Design", color: "#6E56CF" }]} />
        </PropertyRow>
        <PropertyRow icon={Circle} label="Status">
          <Select size="sm" value={status} onChange={setStatus} className={selectClass}
            options={[{ value: "s1", label: "Backlog", color: "#889096" }, { value: "s2", label: "In progress", color: "#0090FF" }]} />
        </PropertyRow>
        <PropertyRow icon={Flag} label="Priority">
          <Select size="sm" value={priority} onChange={setPriority} className={selectClass} options={PRIORITY} />
        </PropertyRow>
        <PropertyRow icon={Clock} label="Duration">
          <input type="number" defaultValue={90} className="w-full bg-transparent text-sm text-foreground outline-none" />
          <span className="shrink-0 text-xs text-muted-foreground">min</span>
        </PropertyRow>
        <PropertyRow icon={CalendarDays} label="Start date">
          <DatePicker mode="date" value={start} onChange={setStart} />
        </PropertyRow>
        <PropertyRow icon={CalendarDays} label="Deadline">
          <DatePicker mode="date" value={deadline} onChange={setDeadline} />
        </PropertyRow>
        <RecurrenceEditor label="Repeat" icon={Repeat} value={repeat} anchor={anchor} onChange={setRepeat} />
      </div>
      <p className="mt-1 px-1 text-[11px] text-muted-foreground">
        Tasks appear on the calendar once scheduled, by hand or with Auto-schedule.
      </p>
      {withLabels ? (
        <div className="pt-3">
          <SidebarSectionTitle>Labels</SidebarSectionTitle>
          <LabelPicker labels={LABELS} selectedIds={labels} onChange={setLabels} />
        </div>
      ) : null}
    </ModalSidebar>
  );
}

export const NewTask = () => (
  <Frame>
  <EntityModalShell icon={ListTodo} label="New task" onClose={() => undefined} headerRight={<CreateButton label="Create task" />}>
    <ModalMain>
      <input defaultValue="Draft onboarding flow" placeholder="Task name" className={titleClass} />
      <Description text={"Map the first-run experience from sign-up to first scheduled task.\nInclude empty states for Inbox and Today, and the calendar connect step."} />
    </ModalMain>
    <TaskSidebar />
  </EntityModalShell>
  </Frame>
);

export const TaskDetail = () => (
  <Frame>
  <EntityModalShell
    icon={ListTodo}
    label="task"
    size="xl"
    closeWithKbd
    onClose={() => undefined}
    headerLeft={
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
        {["Studio", "Website relaunch", "Draft onboarding flow"].map((part, index) => (
          <span key={part} className="inline-flex min-w-0 items-center gap-1.5">
            {index > 0 ? <span className="text-muted-foreground/50">/</span> : null}
            <span className="truncate font-medium text-foreground/80">{part}</span>
          </span>
        ))}
      </div>
    }
    headerRight={
      <>
        <SaveStatusBadge status="saved" />
        <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-transparent bg-foreground px-2.5 text-xs font-semibold text-background hover:opacity-90">
          <Check className="size-3.5" />
          Mark complete
        </button>
        <button type="button" title="Duplicate" className={iconButton}><Copy className="size-3.5" /></button>
        <button type="button" title="Copy link" className={iconButton}><Link2 className="size-3.5" /></button>
        <button type="button" title="Delete" className={iconButton}><Trash2 className="size-3.5" /></button>
      </>
    }
    footer={
      <footer className="flex h-10 shrink-0 items-center justify-between border-t border-border bg-muted/20 px-5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">⌘↵</kbd>
            Save &amp; Close
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">C</kbd>
            Mark Complete
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5">
          <Cloud className="size-3.5" />
          Synced with Cloud
        </span>
      </footer>
    }
  >
    <ModalMain>
      <input defaultValue="Draft onboarding flow" className={titleClass} />
      <Description text={"Map the first-run experience from sign-up to first scheduled task.\nOpen questions: do we ask for working hours before or after the calendar connect?"} />
    </ModalMain>
    <TaskSidebar />
  </EntityModalShell>
  </Frame>
);

export const NewWorkspace = () => (
  <Frame>
  <EntityModalShell icon={FolderKanban} label="New workspace" onClose={() => undefined} headerRight={<CreateButton label="Create workspace" />}>
    <ModalMain>
      <input defaultValue="Studio" placeholder="Workspace name" className={titleClass} />
      <div className="mt-4 flex items-center gap-2">
        <ColorPicker value="#6E56CF" onChange={() => undefined} aria-label="Workspace color" />
        <span className="text-sm text-muted-foreground">Color used for chips, calendar blocks and the sidebar.</span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Workspaces hold their own statuses, labels and custom fields.
      </p>
    </ModalMain>
  </EntityModalShell>
  </Frame>
);
