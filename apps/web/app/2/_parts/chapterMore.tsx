import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";
import { FigDashboard, FigHabits, FigSearch, FigTasks, FigViews } from "./moreFigures";
import { ChapterHead, Footnotes, Page, Rv } from "./ui";

function Item({
  num,
  title,
  body,
  href,
  figure,
  className,
  delay = 0,
}: {
  num: string;
  title: string;
  body: ReactNode;
  href: string;
  figure: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <Rv as="li" delay={delay} className={cn("flex min-w-0 flex-col border-b border-[var(--rule-2)] py-10 lg:px-8 lg:py-12", className)}>
      <p className="d2-mono text-sm text-[var(--verm-2)]">§ {num}</p>
      <h3 className="d2-serif mt-2 text-[1.6rem] leading-tight">{title}</h3>
      <p className="d2-soft mt-2 max-w-[46ch] text-[0.97rem] leading-relaxed">{body}</p>
      <div className="mt-6 h-[200px]">{figure}</div>
      <Link href={href} className="d2-link mt-4 w-fit text-sm">
        Read: {title}
      </Link>
    </Rv>
  );
}

/** Chapter 4: the rest of the planner, as an appendix of short entries. */
export default function ChapterMore() {
  return (
    <section aria-labelledby="more-title" className="border-t border-[var(--rule-2)] bg-[var(--paper-2)] py-20 sm:py-28">
      <Page>
        <ChapterHead
          n={4}
          head="Around the planner"
          headingId="more-title"
          title="Plan, focus and keep track in one place."
          lead="Search that also runs commands, a dashboard you arrange, habits and goals, four calendar views and three ways to look at tasks."
        />
        <ul className="grid lg:grid-cols-12 [&>li]:lg:border-l [&>li]:lg:border-[var(--rule)]">
          <Item
            num="4.1"
            className="lg:col-span-7 lg:!border-l-0 lg:pl-0"
            title="Search and commands"
            href="/help/notes/search"
            body="Press Ctrl/Cmd+K to search tasks, projects, docs, sheets and events, or create something new from the same box."
            figure={<FigSearch />}
          />
          <Item
            num="4.2"
            delay={80}
            className="lg:col-span-5 lg:pr-0"
            title="Dashboard"
            href="/help/notes/dashboard"
            body="Drag and resize cards for focus time, deadlines, a Pomodoro timer, a journal and more. Your layout is saved."
            figure={<FigDashboard />}
          />
          <Item
            num="4.3"
            className="lg:col-span-5 lg:!border-l-0 lg:pl-0"
            title="List, board and Gantt views"
            href="/help/organize/views"
            body="The same tasks as a checklist, a board by stage, or bars on a timeline."
            figure={<FigTasks />}
          />
          <Item
            num="4.4"
            delay={80}
            className="lg:col-span-4"
            title="The calendar"
            href="/help/plan/calendar"
            body="Day, Week, Month and Agenda views, with your events and planned Work side by side."
            figure={<FigViews />}
          />
          <Item
            num="4.5"
            delay={160}
            className="lg:col-span-3 lg:pr-0"
            title="Habits and goals"
            href="/help/plan/today"
            body="Tick habits on Today or your phone and watch the streak grow next to your goals."
            figure={<FigHabits />}
          />
        </ul>
        <Footnotes running="Around the planner" folio={25} notes={[]} />
      </Page>
    </section>
  );
}
