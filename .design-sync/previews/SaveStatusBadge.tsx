import { SaveStatusBadge } from "@timely/ui";

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 420 }} className="flex h-14 items-center justify-between gap-2 border-b border-border bg-muted/20 px-5">
    <span className="truncate text-xs font-medium text-foreground/80">Website relaunch / Draft onboarding flow</span>
    {children}
  </div>
);

export const Saved = () => (
  <Row>
    <SaveStatusBadge status="saved" />
  </Row>
);

export const Saving = () => (
  <Row>
    <SaveStatusBadge status="saving" />
  </Row>
);

export const Unsaved = () => (
  <Row>
    <SaveStatusBadge status="unsaved" />
  </Row>
);

export const ErrorWithRetry = () => (
  <Row>
    <SaveStatusBadge status="error" onRetry={() => undefined} />
  </Row>
);
