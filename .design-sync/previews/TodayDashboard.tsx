import { TimelyProvider, TodayDashboard, sampleApi } from "@timely/ui";

// Full page: the /today route renders it alone inside the app shell's main area.
const Page = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-background" style={{ width: "calc(100vw - 48px)", height: "calc(100vh - 48px)" }}>{children}</div>
);

type Today = Record<string, any>;
// Per-cell states seed the cell's own React Query cache (useToday reads
// ["today", ""], the inbox count ["tasks", "inbox"]); the mock route table is
// page-global, so cells never override routes.
const sample = sampleApi();
const req = { method: "GET", path: "/today", params: {}, query: new URLSearchParams(), body: undefined };
const sampleToday = () => (sample["GET /today"] as (r: typeof req) => Today)(req);

export const MyDay = () => (
  <Page>
    <TodayDashboard />
  </Page>
);

const focusing = () => {
  const today = sampleToday();
  const task = today.todayFocus.find((t: Today) => t.id === "tsk_welcome_wireframes") ?? today.todayFocus[0];
  return { ...today, focusing: { ...task, focusStartedAt: new Date(Date.now() - 25 * 60_000).toISOString() } };
};

export const Focusing = () => (
  <TimelyProvider animations={false} seed={[[["today", ""], focusing()]]}>
    <Page>
      <TodayDashboard />
    </Page>
  </TimelyProvider>
);

const clear = () => ({
  ...sampleToday(),
  focusing: null,
  todayFocus: [],
  items: [],
  overdue: [],
  unscheduled: [],
  inboxCount: 0,
  completedToday: [],
  unfinished: [],
  tomorrowFocus: [],
});

export const ClearDay = () => (
  <TimelyProvider animations={false} seed={[[["today", ""], clear()], [["tasks", "inbox"], []]]}>
    <Page>
      <TodayDashboard />
    </Page>
  </TimelyProvider>
);
