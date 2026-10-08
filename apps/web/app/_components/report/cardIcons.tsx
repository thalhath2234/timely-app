import {
  AlarmClock,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Clock3,
  Flame,
  Goal,
  Grid2x2,
  Hourglass,
  Inbox,
  ListChecks,
  NotebookPen,
  Repeat,
  Sun,
  Timer,
  Zap,
} from "lucide-react";
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
  topThree: ListChecks,
  focusTime: Clock3,
  nextUp: CalendarClock,
  habits: Repeat,
  goal: Goal,
  weeklyReview: ClipboardList,
  inboxZero: Inbox,
  clock: AlarmClock,
  journal: BookOpen,
};

export function BuiltinIcon({ type, className }: { type: BuiltinCardType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={className} />;
}
