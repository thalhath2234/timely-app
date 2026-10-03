import { QueryFailure } from "@timely/ui";

export const NothingCached = () => (
  <div className="flex flex-col p-4" style={{ width: 560, height: 300 }}>
    <QueryFailure what="tasks" hasData={false} onRetry={() => undefined} />
  </div>
);

export const HasCachedData = () => (
  <div className="p-4" style={{ width: 560 }}>
    <QueryFailure what="tasks" hasData error="Server returned 502." onRetry={() => undefined} />
    <div className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border bg-card text-sm">
      {["Draft onboarding flow", "Prepare sprint demo"].map((name) => (
        <div key={name} className="px-3 py-2 text-foreground">{name}</div>
      ))}
    </div>
  </div>
);
