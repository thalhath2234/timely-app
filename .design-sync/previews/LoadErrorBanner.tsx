import { LoadErrorBanner } from "@timely/ui";

const StaleRows = () => (
  <div className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border bg-card text-sm">
    {["Draft onboarding flow", "Review Q4 roadmap with Sam", "Book venue for team offsite"].map((name) => (
      <div key={name} className="flex items-center gap-2 px-3 py-2 text-foreground">
        <span className="size-2 rounded-full bg-muted-foreground/40" />
        {name}
      </div>
    ))}
  </div>
);

export const AboveStaleList = () => (
  <div className="p-4" style={{ width: 560 }}>
    <LoadErrorBanner what="tasks" onRetry={() => undefined} />
    <StaleRows />
  </div>
);

export const WithErrorMessage = () => (
  <div className="p-4" style={{ width: 560 }}>
    <LoadErrorBanner what="projects" error="Network connection lost." onRetry={() => undefined} />
  </div>
);

export const Retrying = () => (
  <div className="p-4" style={{ width: 560 }}>
    <LoadErrorBanner what="docs" onRetry={() => undefined} retrying />
  </div>
);
