import { TimelyProvider, WaitingForSlotRail, sampleApi } from "@timely/ui";
import { useEffect, useRef } from "react";

// In the calendar page the rail sits to the right of the week grid, full height.
const Column = ({ children }: { children: React.ReactNode }) => (
  <div className="flex p-4" style={{ height: 620 }}>{children}</div>
);

export const Ranked = () => (
  <Column>
    <WaitingForSlotRail onSchedule={() => undefined} onOpen={() => undefined} />
  </Column>
);

export const Collapsed = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Wait for the rank query, then fold the list via its header toggle.
    const timer = window.setInterval(() => {
      const toggle = ref.current?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]');
      if (toggle) {
        toggle.click();
        window.clearInterval(timer);
      }
    }, 20);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div ref={ref} className="flex p-4" style={{ height: 74 }}>
      <WaitingForSlotRail onSchedule={() => undefined} onOpen={() => undefined} />
    </div>
  );
};

// A short queue: the top of the sample ranking plus a task that waits on
// another, seeded into this cell's own query cache (useRank reads ["schedule", "rank"]).
const sample = sampleApi();
type Row = { task: { blockedById?: string | null } };
const sampleRank = () =>
  (sample["GET /schedule/rank"] as (r: unknown) => { items: Row[] })({ params: {}, query: new URLSearchParams() }).items;
const shortRank = () => {
  const items = sampleRank();
  return [...items.filter((row) => !row.task.blockedById).slice(0, 2), ...items.filter((row) => row.task.blockedById).slice(0, 1)];
};

export const ShortQueue = () => (
  <TimelyProvider animations={false} seed={[[["schedule", "rank"], shortRank()]]}>
    <div className="flex p-4" style={{ height: 340 }}>
      <WaitingForSlotRail onSchedule={() => undefined} onOpen={() => undefined} />
    </div>
  </TimelyProvider>
);
