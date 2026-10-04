import { EmptyState } from "@timely/ui";
import { FolderKanban, Inbox, Search } from "lucide-react";

export const InboxEmpty = () => (
  <div className="flex w-[520px] p-4">
    <EmptyState
      icon={Inbox}
      title="Inbox is empty"
      description="Press C here to capture a title, or N anywhere to create a full task. Inbox items are never auto-scheduled."
    />
  </div>
);

export const WithAction = () => (
  <div className="flex w-[520px] p-4">
    <EmptyState
      icon={FolderKanban}
      title="No projects yet"
      description="Create a project to group tasks, stages, and deadlines."
      action={
        <button type="button" className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          New project
        </button>
      }
    />
  </div>
);

export const TitleOnly = () => (
  <div className="flex w-[520px] p-4">
    <EmptyState icon={Search} title="No matches for “quarterly review”" />
  </div>
);
