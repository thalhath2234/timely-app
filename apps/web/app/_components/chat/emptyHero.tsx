"use client";
import {
  AlarmClock,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  FolderKanban,
  ListTree,
  LockOpen,
  ReceiptText,
  Sparkles,
  Sun,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useChatPrompts, useDecisionFeedback } from "@/app/utils/hooks/decisions";
import { motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import {
  listContainerVariants,
  listItemVariants,
} from "@/app/_components/_ui/motion";

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
  const fitted = prompts.data?.prompts?.length ? prompts.data : null;
  const shown = fitted
    ? fitted.prompts.map((prompt) => ({ icon: PROMPT_ICONS[prompt.key] ?? Sparkles, title: prompt.title, text: prompt.text }))
    : suggestions;
  const pick = (text: string) => {
    if (fitted?.logId) feedback.mutate({ logId: fitted.logId, accepted: true });
    onPick(text);
  };
  return (
    <div className={cn("mx-auto max-w-2xl py-10", compact && "py-3")}>
      <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
        <Sparkles className="size-3.5" />
        Timely assistant
      </div>
      <h2
        className={cn(
          "text-3xl font-semibold tracking-tight",
          !compact && "md:text-4xl",
        )}
      >
        What would you like
        <br />
        to make happen?
      </h2>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
        Turn an idea into a project, shape a sheet, or plan your week. Small
        changes happen right away; bigger ones wait for your approval.
      </p>
      {fitted?.project ? (
        <p className="mt-6 text-xs font-medium text-muted-foreground" data-testid="chat-prompts-project">
          Ideas for {fitted.project}
        </p>
      ) : null}
      <motion.div
        key={fitted ? "fitted" : "fixed"}
        variants={listContainerVariants}
        initial="hidden"
        animate="visible"
        className={cn("mt-7 grid gap-2.5 sm:grid-cols-2", compact && "mt-5", fitted?.project && "mt-2")}
      >
        {shown.map(({ icon: Icon, title, text }) => (
          <motion.button
            key={title}
            variants={listItemVariants}
            type="button"
            onClick={() => pick(text)}
            className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {text}
              </span>
            </span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
