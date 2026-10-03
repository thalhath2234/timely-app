import type { Chat, ChatMessage, ChatStep } from "@/app/utils/api/chat";
import type { Clock } from "./clock";
import { D } from "./content";
import { T } from "./tasks";
import { P_ONBOARDING, WS_STUDIO } from "./workspace";

const msg = (id: string, role: "user" | "assistant", content: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role,
  content,
  createdAt,
  kind: "",
  ...extra,
});

export function buildChats(clock: Clock): Chat[] {
  const { iso, ymd, ago } = clock;

  // 1. A finished planning run whose changes were applied.
  const appliedSteps: ChatStep[] = [
    {
      tool: "schedule_task",
      summary: "Block 1:30-3:00 PM today for \"Define spacing and radius tokens\"",
      arguments: { taskId: T.tokens, start: iso(0, 13, 30), end: iso(0, 15, 0) },
      status: "done",
      result: { task: { id: T.tokens, name: "Define spacing and radius tokens" } },
    },
    {
      tool: "set_today_focus",
      summary: "Add \"Write empty-state copy for the workspace picker\" to Today focus",
      arguments: { taskId: T.emptyCopy, date: ymd(0) },
      status: "done",
      result: { task: { id: T.emptyCopy, name: "Write empty-state copy for the workspace picker" } },
    },
    {
      tool: "create_task",
      summary: "Create \"Prepare critique questions for the welcome flow\" (20 min, due today)",
      arguments: {
        name: "Prepare critique questions for the welcome flow",
        projectId: P_ONBOARDING,
        duration: 20,
        deadline: ymd(0),
        priorityLevel: "Medium",
      },
      status: "done",
      result: { task: { id: "tsk_critique_questions", name: "Prepare critique questions for the welcome flow" } },
    },
  ];
  const planDay: Chat = {
    id: "chat_plan_day",
    title: "Plan today around the critique",
    status: "idle",
    phase: "",
    webSearch: false,
    provider: "claude",
    model: "sonnet",
    context: [{ kind: "today", label: "Today", value: ymd(0) }],
    plan: [],
    revision: 4,
    unread: false,
    error: "",
    createdAt: earlier(clock, 190),
    updatedAt: earlier(clock, 170),
    messages: [
      msg("m_pd_1", "user", "I have the onboarding critique at 3:30. Help me fit the token work in today without touching my 1:1.", earlier(clock, 190)),
      msg(
        "m_pd_2",
        "assistant",
        "You have two open gaps today: **1:30-3:00 PM** and a short one after the critique. The spacing tokens task is two days overdue and marked Urgent, so it should take the long gap.\n\nI'd also add the empty-state copy to your Today focus (it's 45 minutes and unblocks the invite screen), and create a 20-minute task to write critique questions so the session stays focused on the skip path.",
        earlier(clock, 188),
        { steps: appliedSteps },
      ),
      msg("m_pd_3", "user", "Looks good, go ahead.", earlier(clock, 175)),
      msg("m_pd_4", "assistant", "Done: 3 changes applied", earlier(clock, 174), { kind: "notice" }),
      msg(
        "m_pd_5",
        "assistant",
        "All set. Your afternoon is **1:30 tokens → 3:30 critique**, and the critique-questions task is due today. Your 1:1 with Priya at 11:30 is untouched.",
        earlier(clock, 170),
      ),
    ],
  };

  // 2. A proposal waiting for review.
  const proposal: ChatStep[] = [
    {
      tool: "move_block",
      summary: "Move part 2 of \"Design the workspace-invite screen\" earlier, before the stakeholder review",
      arguments: { blockId: "blk_invite_screen_1", start: iso(4, 8, 30), end: iso(4, 10, 30) },
      before: { start: iso(4, 13, 30), end: iso(4, 15, 30) },
      status: "pending",
    },
    {
      tool: "create_event",
      summary: "Add \"Prep: stakeholder review\" for 30 minutes before the review",
      arguments: {
        title: "Prep: stakeholder review",
        start: iso(4, 10, 0),
        end: iso(4, 10, 30),
        workspaceId: WS_STUDIO,
        projectId: P_ONBOARDING,
      },
      status: "pending",
    },
    {
      tool: "update_task",
      summary: "Raise \"Accessibility pass on onboarding color contrast\" to High",
      arguments: { taskId: T.contrast, priorityLevel: "High" },
      before: { priorityLevel: "Medium" },
      status: "pending",
    },
  ];
  const reviewPrep: Chat = {
    id: "chat_review_prep",
    title: "Get ready for the stakeholder review",
    status: "approval",
    phase: "",
    webSearch: false,
    provider: "claude",
    model: "sonnet",
    context: [{ kind: "project", label: "Onboarding Redesign", value: P_ONBOARDING }],
    plan: proposal,
    revision: 2,
    unread: true,
    error: "",
    createdAt: ago(40),
    updatedAt: ago(38),
    messages: [
      msg("m_rp_1", "user", "What do I need to have done before the stakeholder review, and is my schedule realistic?", ago(40)),
      msg(
        "m_rp_2",
        "assistant",
        "The review wants to see the invite screen in high fidelity, but part 2 of that work is scheduled **after** the review. The contrast pass also isn't scheduled, and stakeholders asked about accessibility last time.\n\nI've proposed three changes below. Nothing is saved until you approve.",
        ago(38),
      ),
    ],
  };

  // 3. A plain question answered from her docs.
  const research: Chat = {
    id: "chat_research_themes",
    title: "Top onboarding research themes",
    status: "idle",
    phase: "",
    webSearch: false,
    provider: "claude",
    model: "sonnet",
    context: [{ kind: "object", label: "Research synthesis: new-user interviews", value: D.research }],
    plan: [],
    revision: 1,
    unread: false,
    error: "",
    createdAt: iso(-2, 16, 10),
    updatedAt: iso(-2, 16, 12),
    messages: [
      msg("m_rs_1", "user", "Summarize the top three themes from my interview synthesis in one line each, for a Slack update.", iso(-2, 16, 10)),
      msg(
        "m_rs_2",
        "assistant",
        "From *Research synthesis: new-user interviews*:\n\n1. **Invites feel risky** - admins wait until the workspace looks finished before inviting anyone.\n2. **Empty states don't teach** - 5 of 8 people never found the template gallery.\n3. **Naming is a speed bump** - choosing a workspace name stalled several sessions for minutes.",
        iso(-2, 16, 12),
      ),
    ],
  };

  return [reviewPrep, planDay, research];
}

/** `minutes` before now, but kept on today's date so the chat groups under Today. */
function earlier(clock: Clock, minutes: number) {
  return clock.earlierToday(minutes);
}
