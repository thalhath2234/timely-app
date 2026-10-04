import { ContextChips } from "@timely/ui";

const noop = () => {};

export const Attached = () => (
  <div className="p-4" style={{ width: 520 }}>
    <ContextChips
      disabled={false}
      onRemove={noop}
      chips={[
        { kind: "project", label: "Website relaunch", value: "p_web" },
        { kind: "calendar", label: "This week", value: "2024-05-13/2024-05-19" },
        { kind: "tasks", label: "3 selected tasks", value: "t_1,t_2,t_3" },
        { kind: "selection", label: "“Kickoff is moved to Monday…”", value: "doc:d_plan#12-48" },
      ]}
    />
  </div>
);

export const AllKinds = () => (
  <div className="p-4" style={{ width: 560 }}>
    <ContextChips
      disabled={false}
      onRemove={noop}
      chips={[
        { kind: "today", label: "Today", value: "today" },
        { kind: "workspace", label: "Studio", value: "w_studio" },
        { kind: "object", label: "Onboarding plan", value: "doc:d_plan" },
        { kind: "sheet-tab", label: "Budget · Expenses", value: "s_budget:expenses" },
        { kind: "search", label: "Search: “quarterly review”", value: "quarterly review" },
        { kind: "location", label: "Inbox", value: "/inbox" },
      ]}
    />
  </div>
);

export const Disabled = () => (
  <div className="p-4" style={{ width: 520 }}>
    <ContextChips
      disabled
      onRemove={noop}
      chips={[
        { kind: "project", label: "Website relaunch", value: "p_web" },
        { kind: "calendar", label: "This week", value: "week" },
      ]}
    />
  </div>
);
