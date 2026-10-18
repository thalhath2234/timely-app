"use client";
import {
  AlarmClock,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  FolderKanban,
  KeyRound,
  ListTree,
  LockOpen,
  ReceiptText,
  Sparkles,
  Sun,
  Table2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChatPrompts, useDecisionFeedback } from "@/app/utils/hooks/decisions";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { useAgentProviders } from "@/app/utils/hooks/agentProviders";
import { buttonClass } from "@/app/_components/_ui/button";
import { readyProviders } from "./modelMenu";
import {
  listContainerVariants,
  listItemVariants,
} from "@/app/_components/_ui/motion";

/** Loaded with the hero only: Remotion stays out of every other page. */
const LoopPlayer = dynamic(() => import("@/app/_components/film/loopPlayer"), {
  ssr: false,
  loading: () => <div className="aspect-[8/5] w-full bg-panel" />,
});

const suggestions: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: FolderKanban,
    title: "Start a project",
    text: "Create a project for a PDF tool and a document with an initial plan.",
  },
  {
    icon: Table2,
    title: "Build a budget",
    text: "Create a project budget sheet with Item, Quantity, Unit price, and Total columns.",
  },
  {
    icon: CalendarDays,
    title: "Make room to learn",
    text: "Create a workspace for learning Japanese and add three study sessions.",
  },
  {
    icon: ReceiptText,
    title: "Save a receipt",
    text: "Attach a receipt photo and I’ll add it to your expense sheet.",
  },
];

/** Icons for the example prompts smart suggestions fit to a project. */
const PROMPT_ICONS: Record<string, LucideIcon> = {
  next: ArrowRight,
  status: ClipboardList,
  plan_week: CalendarDays,
  overdue: AlarmClock,
  blocked: LockOpen,
  breakdown: ListTree,
  find_time: Clock,
  brief: FileText,
  budget: Table2,
  day: Sun,
};

export default function EmptyHero({
  compact = false,
  onPick,
}: {
  compact?: boolean;
  onPick: (text: string) => void;
}) {
  // On a project's page the examples fit that project; elsewhere, the
  // project worked on most recently. The fixed examples stay until they load.
  const pathname = usePathname();
  const match = pathname?.match(/^\/projects\/([^/?#]+)/);
  const prompts = useChatPrompts(match ? decodeURIComponent(match[1]) : undefined);
  const feedback = useDecisionFeedback();
  const providers = useAgentProviders();
  // Chat needs a provider; the rest of Timely does not. Say so before a
  // message is sent rather than after it fails.
  const needsProvider = Boolean(providers.data) && readyProviders(providers.data).length === 0;
  const fitted = prompts.data?.prompts?.length ? prompts.data : null;
  const shown = fitted
    ? fitted.prompts.map((prompt) => ({ icon: PROMPT_ICONS[prompt.key] ?? Sparkles, title: prompt.title, text: prompt.text }))
    : suggestions;
  const pick = (text: string) => {
    if (fitted?.logId) feedback.mutate({ logId: fitted.logId, accepted: true });
    onPick(text);
  };
  return (
    <div className={cn("mx-auto max-w-2xl py-8", compact ? "py-3" : "lg:max-w-4xl")}>
      <div className={cn("flex flex-col gap-5", !compact && "lg:flex-row lg:items-center lg:gap-8")}>
        <div className="min-w-0 flex-1">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-2.5 py-0.5 text-[11px] font-medium text-primary">
            <Sparkles className="size-3.5" />
            Timely assistant
          </div>
          <h2 className={cn("text-[26px] font-semibold leading-8 tracking-[-0.02em]", compact && "text-xl leading-7")}>What would you like to make happen?</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Turn an idea into a project, shape a sheet, or plan your week. Small changes happen right away; bigger ones wait for your approval.
          </p>
        </div>
        {!compact ? (
          <div className="w-full shrink-0 overflow-hidden rounded-[12px] border border-border bg-panel lg:w-[360px]">
            <LoopPlayer id="ask" />
          </div>
        ) : null}
      </div>
      {needsProvider ? (
        <div
          data-testid="chat-needs-provider"
          className={cn("mt-5 flex items-center gap-3 rounded-[12px] border border-primary/25 bg-primary/[0.06] px-3.5 py-2.5", compact && "mt-4")}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-primary/12 text-primary">
            <KeyRound className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Connect an AI provider to chat</p>
            <p className="truncate text-xs text-muted-foreground">Your own OpenRouter key, Claude Code or Codex. The rest of Timely works without one.</p>
          </div>
          <Link href="/settings?tab=agent" className={buttonClass({ size: "sm" })}>
            Settings
          </Link>
        </div>
      ) : null}
      <p className="mt-5 px-1 text-[13px] font-semibold text-foreground" data-testid={fitted?.project ? "chat-prompts-project" : undefined}>
        {fitted?.project ? `Ideas for ${fitted.project}` : "Try one of these"}
      </p>
      <motion.div
        key={fitted ? "fitted" : "fixed"}
        variants={listContainerVariants}
        initial="hidden"
        animate="visible"
        className="mt-1.5 grid gap-2 sm:grid-cols-2"
        data-testid="chat-starter-prompts"
      >
        {shown.map(({ icon: Icon, title, text }) => (
          <motion.button
            key={title}
            variants={listItemVariants}
            type="button"
            onClick={() => pick(text)}
            className={cn(
              "group flex min-h-14 items-center gap-3 rounded-[12px] border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/40",
              needsProvider && "opacity-70",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{title}</span>
              <span className="block truncate text-xs text-muted-foreground">{text}</span>
            </span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
