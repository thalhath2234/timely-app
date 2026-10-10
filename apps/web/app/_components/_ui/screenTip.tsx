"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, X } from "lucide-react";
import { cn } from "@/app/utils/cn";
import type { TipAction, TipScreen } from "@/app/utils/api/decisions";
import { useDecisionFeedback, useDismissTip, useScreenTip } from "@/app/utils/hooks/decisions";

const ACTION: Record<TipAction, { label: string; href: string }> = {
  inbox: { label: "Open Inbox", href: "/inbox" },
  calendar: { label: "Open Calendar", href: "/calendar" },
  settings_schedule: { label: "Set hours", href: "/settings?tab=schedule" },
  settings_workspaces: { label: "Open settings", href: "/settings?tab=workspaces" },
};

/** One tip smart suggestions picked for this screen. Dismissed tips never
 * come back; nothing shows when suggestions are off or no tip fits. */
export default function ScreenTip({ screen, className }: { screen: TipScreen; className?: string }) {
  const router = useRouter();
  const { data } = useScreenTip(screen);
  const dismiss = useDismissTip();
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<string | null>(null);
  const tip = data?.tip;
  if (!tip || hidden === tip.key) return null;
  const action = tip.action ? ACTION[tip.action] : undefined;
  return (
    <div
      data-testid="screen-tip"
      role="note"
      className={cn("flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground", className)}
    >
      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 leading-5">{tip.text}</span>
      {action ? (
        <button
          type="button"
          onClick={() => {
            if (data?.logId) feedback.mutate({ logId: data.logId, accepted: true });
            router.push(action.href);
          }}
          className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10"
        >
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss tip"
        title="Don't show this tip again"
        onClick={() => {
          setHidden(tip.key);
          dismiss.mutate({ key: tip.key, logId: data?.logId });
        }}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
