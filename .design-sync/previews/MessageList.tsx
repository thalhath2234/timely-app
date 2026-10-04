import { MessageList } from "@timely/ui";

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const slot = (dayOffset: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const base = {
  id: "c_week",
  title: "Plan the website relaunch week",
  status: "idle",
  phase: "",
  webSearch: false,
  context: [],
  plan: [],
  revision: 3,
  unread: false,
  error: "",
  updatedAt: at(2),
  createdAt: at(60 * 26),
};

export const Conversation = () => (
  <div className="p-6" style={{ width: 720 }}>
    <MessageList
      chat={{
        ...base,
        messages: [
          {
            id: "m1",
            role: "user",
            content: "Can you find two hours for the research synthesis before Friday? Mornings only.",
            createdAt: at(60 * 25),
          },
          {
            id: "m2",
            role: "assistant",
            content:
              "Thursday 9:30–11:30 is free and inside your focus block. I scheduled **Review Q4 research notes** there and kept lunch with Sam at 12:30.",
            createdAt: at(60 * 25 - 1),
            steps: [
              {
                tool: "schedule_task",
                summary: "Schedule “Review Q4 research notes” Thursday 9:30–11:30",
                arguments: { task: "t_research", start: slot(1, 9, 30), end: slot(1, 11, 30) },
                status: "done",
                result: { task: { id: "t_research", title: "Review Q4 research notes" } },
              },
            ],
          },
          {
            id: "m3",
            role: "user",
            content: "Great. Now set up the relaunch project with an onboarding task.",
            createdAt: at(14),
          },
          {
            id: "m4",
            role: "assistant",
            kind: "archive",
            content: "Discarded proposal",
            createdAt: at(12),
            steps: [
              { tool: "create_project", summary: "Create project “Relaunch”", arguments: { name: "Relaunch" }, status: "discarded" },
              { tool: "create_task", summary: "Add task “Onboarding”", arguments: { title: "Onboarding" }, status: "discarded" },
            ],
          },
          {
            id: "m5",
            role: "assistant",
            content:
              "Done. **Website relaunch** now has **Draft onboarding flow** (2h, high priority), scheduled for tomorrow morning.",
            createdAt: at(3),
          },
          { id: "m6", role: "assistant", kind: "notice", content: "Done · 3 changes applied", createdAt: at(2) },
        ],
      }}
    />
  </div>
);

export const WithReceipt = () => (
  <div className="p-6" style={{ width: 720 }}>
    <MessageList
      chat={{
        ...base,
        sensitive: true,
        messages: [
          {
            id: "r1",
            role: "user",
            content: "Add this to my expenses sheet.",
            createdAt: at(8),
          },
          {
            id: "r2",
            role: "assistant",
            content: "I read the receipt from **Blue Bottle Coffee**. Review the details below before I add it to **Website relaunch budget**.",
            createdAt: at(7),
            receipt: {
              merchant: "Blue Bottle Coffee",
              date: "2024-05-14",
              currency: "USD",
              category: "Meals",
              subtotal: "23.50",
              tax: "2.09",
              tip: "4.00",
              discount: "",
              total: "29.59",
              taxIncluded: false,
              items: [
                { description: "Oat latte", quantity: "2", unitPrice: "5.75", amount: "11.50", category: "Meals" },
                { description: "Avocado toast", quantity: "1", unitPrice: "9.00", amount: "9.00", category: "Meals" },
              ],
              issues: [],
            },
          },
          { id: "r3", role: "assistant", kind: "notice", content: "Stopped by you", createdAt: at(6) },
        ],
      }}
    />
  </div>
);

export const WithImage = () => (
  <div className="p-6" style={{ width: 720 }}>
    <MessageList
      chat={{
        ...base,
        sensitive: true,
        images: [{ id: "img_whiteboard", name: "whiteboard.jpg", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() }],
        messages: [
          {
            id: "w1",
            role: "user",
            content: "Turn these sticky notes into tasks for next week.",
            createdAt: at(9),
            imageIds: ["img_whiteboard"],
          },
          {
            id: "w2",
            role: "assistant",
            content:
              "I found six notes. **Onboarding flow v3** and **Usability round 2** go to Onboarding Redesign, **Ship DS tokens** to Design System v2. Review the proposal before I create them.",
            createdAt: at(8),
          },
        ],
      }}
    />
  </div>
);
