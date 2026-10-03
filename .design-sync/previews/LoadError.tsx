import { LoadError } from "@timely/ui";

export const Tasks = () => (
  <div className="flex flex-col p-4" style={{ width: 560, height: 320 }}>
    <LoadError what="tasks" onRetry={() => undefined} />
  </div>
);

export const WithServerMessage = () => (
  <div className="flex flex-col p-4" style={{ width: 560, height: 320 }}>
    <LoadError
      what="projects"
      error={new Error("Request timed out after 30 seconds.")}
      onRetry={() => undefined}
    />
  </div>
);

export const Retrying = () => (
  <div className="flex flex-col p-4" style={{ width: 560, height: 320 }}>
    <LoadError what="calendar events" onRetry={() => undefined} retrying />
  </div>
);

export const NoRetry = () => (
  <div className="flex flex-col p-4" style={{ width: 560, height: 320 }}>
    <LoadError what="notifications" />
  </div>
);
