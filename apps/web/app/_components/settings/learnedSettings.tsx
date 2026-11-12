"use client";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { LEARNS_ON_AGENT_ONLY } from "@timely/contract/agentChat";
import { LEARNED_TITLE } from "@timely/contract/agentLearning";
import { useChatSettings } from "@/app/utils/hooks/chat";
import LearnedActivity from "./learnedActivity";
import LearnedMemory from "./learnedMemory";
import LearnedPending from "./learnedPending";
import LearnedRail from "./learnedRail";
import LearnedSkills from "./learnedSkills";

/**
 * Settings → What Timely learned (plan 9b.4): Waiting for you, Skills
 * (with Updated upstream), About you, Notes and Activity, beside the
 * Learning and "Search my past chats" switches and the download. The
 * switches sit in a column on wide windows and above the lists on narrow
 * ones, as on the Agent tab. `skill` and `part` come from a chat chip's
 * View: that skill opens, or About you / Notes is scrolled to.
 */
export default function LearnedSettings({
  skill,
  part,
}: {
  skill: string | null;
  part: string | null;
}) {
  const chat = useChatSettings().data;
  const classic = chat?.engine === "classic";
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,42rem)_340px] xl:gap-10"
      data-testid="learned-settings"
    >
      <div className="xl:col-span-2">
        <h2 className="text-base font-semibold text-foreground">{LEARNED_TITLE}</h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          As you chat, Timely saves skills and notes so it does things your way next time. Anything it learned from an
          outside page or a bot waits here for you first. You can undo any change.
        </p>
        {classic && (
          <p role="status" className="mt-3 flex max-w-2xl items-start gap-2 text-xs text-muted-foreground">
            <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning-text" />
            <span>
              {LEARNS_ON_AGENT_ONLY} Choose it in{" "}
              <Link href="/settings?tab=agent" className="font-medium text-primary hover:underline">
                Settings › Agent
              </Link>
              .
            </span>
          </p>
        )}
      </div>
      <div className="min-w-0 xl:order-last">
        <LearnedRail />
      </div>
      <div className="flex min-w-0 max-w-2xl flex-col gap-6">
        <LearnedPending />
        <LearnedSkills focus={skill} />
        <LearnedMemory part={part} />
        <LearnedActivity />
      </div>
    </div>
  );
}
