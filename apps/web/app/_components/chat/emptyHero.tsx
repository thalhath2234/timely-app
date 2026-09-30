"use client";
import {
  CalendarDays,
  FolderKanban,
  ReceiptText,
  Sparkles,
  Table2,
  type LucideIcon,
} from "lucide-react";
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

export default function EmptyHero({
  compact = false,
  onPick,
}: {
  compact?: boolean;
  onPick: (text: string) => void;
}) {
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
      <motion.div
        variants={listContainerVariants}
        initial="hidden"
        animate="visible"
        className={cn("mt-7 grid gap-2.5 sm:grid-cols-2", compact && "mt-5")}
      >
        {suggestions.map(({ icon: Icon, title, text }) => (
          <motion.button
            key={title}
            variants={listItemVariants}
            type="button"
            onClick={() => onPick(text)}
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
