import { ConfirmDialog } from "@timely/ui";

export const DeleteTask = () => (
  <ConfirmDialog
    title="Delete “Draft onboarding flow”?"
    description="The task, its checklist and its calendar blocks will be removed. This can’t be undone."
    onConfirm={() => undefined}
    onCancel={() => undefined}
  />
);

export const Pending = () => (
  <ConfirmDialog
    title="Archive project “Website relaunch”?"
    description="Its 14 open tasks move to the archive and stop being scheduled."
    confirmLabel="Archive"
    pending
    pendingLabel="Archiving…"
    onConfirm={() => undefined}
    onCancel={() => undefined}
  />
);
