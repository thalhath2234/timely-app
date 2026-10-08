import { CalendarCheck, Flame, Grid2x2, Hourglass, NotebookPen, Sun, Timer, Zap } from "lucide-react";
import type { BuiltinCardType } from "@timely/contract/dashboard";

const ICONS: Record<BuiltinCardType, typeof Timer> = {
  pomodoro: Timer,
  today: Sun,
  quickCapture: Zap,
  notes: NotebookPen,
  streak: Flame,
  dayProgress: Hourglass,
  matrix: Grid2x2,
  countdown: CalendarCheck,
};

export function BuiltinIcon({ type, className }: { type: BuiltinCardType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} />;
}
