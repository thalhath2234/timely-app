import { ChatText } from "@timely/ui";

const plan = `## Your Thursday
I moved **Draft onboarding flow** to 9:30 so it lands in your focus block, and kept lunch with Sam at 12:30.
1. Draft onboarding flow — 9:30–11:00
2. Review Q4 research notes — 11:15–12:00
3. Weekly planning — 16:00
- \`Client review\` stays fixed at 14:00
- Dentist moved to Friday morning
Details: [Website relaunch board](https://timely.app/projects/website-relaunch)`;

export const AssistantPlan = () => (
  <div className="w-[480px] p-4">
    <ChatText text={plan} />
  </div>
);

export const UserBubble = () => (
  <div className="flex w-[480px] justify-end p-4">
    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground shadow-sm">
      <ChatText
        text="Can you find two hours for the research synthesis before Friday? Mornings only."
        className="text-primary-foreground"
      />
    </div>
  </div>
);

export const Muted = () => (
  <div className="w-[480px] p-4">
    <ChatText
      className="text-muted-foreground"
      text={"No changes yet. Ask me to plan your week, or paste a list like:\n- call the landlord\n- send invoice #1042"}
    />
  </div>
);
