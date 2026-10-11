import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import packageJson from "@/package.json";
import { CLAUDE_CODE_URL, CODEX_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { cn } from "@/app/utils/cn";
import { McpGraphic, ProviderGraphic, ReviewGraphic, SuggestGraphic } from "./_parts/aiParts";
import { C, WEEK } from "./_parts/data";
import { DocGraphic, SheetGraphic } from "./_parts/docsSheets";
import Downloads from "./_parts/downloads";
import { CalendarViews, DashboardMini, HabitsMini, SearchMini, TasksMorph } from "./_parts/features";
import { fontClasses } from "./_parts/fonts";
import Footer from "./_parts/footer";
import Header from "./_parts/header";
import HeroTitle from "./_parts/heroTitle";
import HeroWeek from "./_parts/heroWeek";
import { KineticHeading, MotionRoot, Rise, SlidingNumeral, Wipe } from "./_parts/kinetic";
import LoopPinned from "./_parts/loopPinned";
import PrivateDiagram from "./_parts/privateDiagram";
import "./_parts/design.css";

export const metadata: Metadata = { title: "Timely · Design 4" };

const NEXT_WEEK: { short: string; date: number; color?: keyof typeof C; fill: number }[] = [
  { short: "Mon", date: 19, color: "violet", fill: 0.55 },
  { short: "Tue", date: 20, color: "amber", fill: 0.35 },
  { short: "Wed", date: 21, color: "green", fill: 0.7 },
  { short: "Thu", date: 22, color: "blue", fill: 0.45 },
  { short: "Fri", date: 23, color: "pink", fill: 0.6 },
  { short: "Sat", date: 24, fill: 0 },
  { short: "Sun", date: 25, fill: 0 },
];

function Cta({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Link href="/signup" className="d4-btn d4-btn-solid">
        Register
        <ArrowRight aria-hidden className="size-4" />
      </Link>
      <Link href="/login" className="d4-btn">
        Log in
      </Link>
      <a href={REPO_URL} className="d4-btn">
        <GitHubMark className="size-4" />
        GitHub
      </a>
    </div>
  );
}

/** Section opener: a heavy rule, the section's number set huge in its colour, a heading that gains weight on scroll. */
function SectionHead({
  num,
  label,
  color,
  title,
  lead,
  headingId,
}: {
  num: string;
  label: string;
  color: string;
  title: ReactNode;
  lead: ReactNode;
  headingId: string;
}) {
  return (
    <div className="d4-cols">
      <div className="col-span-4 flex items-center justify-between border-t-2 border-[var(--ink)] pt-3 md:col-span-12">
        <span className="d4-label">
          <span className="d4-mono mr-3 font-normal">{num}</span>
          {label}
        </span>
        <Wipe color={color} className="h-3 w-24 md:w-40" />
      </div>
      <SlidingNumeral className="d4-num col-span-4 mt-6 text-[clamp(7rem,14.5vw,13rem)] md:col-span-3 md:mt-8">
        <span style={{ color }}>{num}</span>
      </SlidingNumeral>
      <div className="col-span-4 mt-6 md:col-span-9 md:mt-10">
        <KineticHeading id={headingId} className="d4-h2 max-w-[15ch]">
          {title}
        </KineticHeading>
        <div className="d4-lead mt-6 max-w-[58ch]">{lead}</div>
      </div>
    </div>
  );
}

function SubHead({ num, title, children }: { num: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <p className="d4-mono text-[12px] text-[var(--faint)]">{num}</p>
      <h3 className="d4-h3 mt-2">{title}</h3>
      {children ? <div className="d4-body mt-3 max-w-[44ch] space-y-3">{children}</div> : null}
    </div>
  );
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 grid grid-cols-2 border-t border-[var(--line-2)]">
      {items.map((item, index) => (
        <li key={item} className={cn("flex items-baseline gap-2.5 border-b border-[var(--line)] py-2.5 text-[14px]", index % 2 === 0 && "pr-3")}>
          <span className="d4-mono text-[10.5px] text-[var(--faint)]">{String(index + 1).padStart(2, "0")}</span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function DesignFour() {
  return (
    <div className={`d4 ${fontClasses}`}>
      <div className="d4-gridlines" aria-hidden />
      <MotionRoot>
        <Header />
        <main id="main-content">
          {/* ---- Hero ---- */}
          <section aria-labelledby="d4-hero" className="d4-wrap pt-5 pb-20 md:pt-7 md:pb-28">
            <div className="d4-cols d4-label gap-y-1 text-[11px] text-[var(--soft)]">
              <span className="col-span-2 md:col-span-3">Timely {packageJson.version}</span>
              <span className="col-span-2 md:col-span-3">
                W{WEEK.number} · {WEEK.label}
              </span>
              <span className="hidden md:col-span-3 md:block">Plan · Organize · Write</span>
              <span className="hidden md:col-span-3 md:block">Runs on your own computer</span>
            </div>

            <div id="d4-hero">
              <HeroTitle
                lines={["Capture it.", "Timely plans the week."]}
                className="d4-display mt-5 text-[clamp(3.4rem,8.1vw,8.4rem)] md:mt-7"
              />
            </div>

            <div className="d4-cols mt-8 gap-y-10 md:mt-10">
              <div className="col-span-4 flex flex-col gap-8 md:col-span-4 md:pr-10 lg:col-span-3">
                <div>
                  <p className="d4-lead text-[var(--ink)]">
                    Timely is a private planner. Write down a thought; Timely places it on your week, around your
                    meetings and inside your working hours.
                  </p>
                  <p className="d4-body mt-4">Tasks, calendar, docs, sheets and an assistant in one app that runs on your own computer, with a phone app that pairs to it.</p>
                </div>
                <Cta className="[&>*]:flex-1 sm:[&>*]:flex-none md:flex-col md:[&>*]:w-full lg:flex-row lg:[&>*]:w-auto lg:[&>*]:flex-1" />
              </div>
              <div className="col-span-4 md:col-span-8 lg:col-span-9">
                <HeroWeek />
                <p className="sr-only">
                  Animation: tasks typed into Capture get a length, project and deadline, then slide onto Monday to
                  Friday of week 42, into free time between events and inside working hours.
                </p>
              </div>
            </div>
          </section>

          {/* ---- 01 AI ---- */}
          <section id="ai" aria-labelledby="d4-ai" className="d4-wrap pb-24 md:pb-36">
            <SectionHead
              num="01"
              label="AI"
              color={C.violet.bg}
              headingId="d4-ai"
              title="Bring the AI plan you already pay for."
              lead={
                <p>
                  The assistant runs on your Claude or ChatGPT subscription. It plans with you, proposes changes you
                  review, fills in the details while you clarify, and lets your own agents in over MCP.
                </p>
              }
            />

            <div className="d4-cols mt-16 gap-y-8 md:mt-24">
              <Rise className="col-span-4 md:col-span-4 md:pr-10">
                <SubHead num="1.1" title="Use the subscription you have">
                  <p>
                    <a className="d4-link" href={CLAUDE_CODE_URL}>
                      Claude Code
                    </a>{" "}
                    and{" "}
                    <a className="d4-link" href={CODEX_URL}>
                      Codex
                    </a>{" "}
                    use the sign-in already on your computer, so chats run on your Claude or ChatGPT plan.
                  </p>
                  <p>
                    Or use OpenCode Go, local models through Ollama, or an API key for OpenRouter, Anthropic, OpenAI,
                    Gemini, DeepSeek, xAI, Mistral and more. Switch the model per chat.
                  </p>
                </SubHead>
              </Rise>
              <div className="col-span-4 md:col-span-8">
                <ProviderGraphic />
              </div>
            </div>

            <div className="d4-cols mt-20 gap-y-8 md:mt-28">
              <div className="order-2 col-span-4 md:order-1 md:col-span-8 md:pr-10">
                <ReviewGraphic />
              </div>
              <Rise className="order-1 col-span-4 md:order-2 md:col-span-4">
                <SubHead num="1.2" title="It proposes. You apply.">
                  <p>
                    Ask for a plan and the assistant creates projects, tasks, events, docs and sheets, and places Work
                    on your calendar.
                  </p>
                  <p>
                    Bigger changes wait as a list you read first. Choose <strong className="text-[var(--ink)]">Apply changes</strong>{" "}
                    or <strong className="text-[var(--ink)]">Discard</strong>; nothing is written before that.
                  </p>
                </SubHead>
              </Rise>
            </div>

            <div className="d4-cols mt-20 gap-y-16 md:mt-28">
              <div className="col-span-4 md:col-span-6 md:pr-10">
                <SubHead num="1.3" title="Smart suggestions while you clarify">
                  <p>Clarify suggests the type, length, priority, project, labels and dates from the words you typed. Nothing changes until you save.</p>
                </SubHead>
                <div className="mt-6">
                  <SuggestGraphic />
                </div>
              </div>
              <div className="col-span-4 md:col-span-6 md:border-l md:border-[var(--line-2)] md:pl-10">
                <SubHead num="1.4" title="Your own agents, over MCP">
                  <p>
                    Claude Code, Codex or any MCP client connects to Timely&apos;s MCP server with a personal key and
                    can read and plan your calendar, tasks, docs and sheets. Revoke a key at any time.
                  </p>
                </SubHead>
                <div className="mt-6">
                  <McpGraphic />
                </div>
              </div>
            </div>
          </section>

          {/* ---- 02 How it works ---- */}
          <section id="how-it-works" aria-labelledby="d4-how" className="pb-24 md:pb-36">
            <div className="d4-wrap pb-10 md:pb-14">
              <SectionHead
                num="02"
                label="How it works"
                color={C.amber.bg}
                headingId="d4-how"
                title="Four steps, every week."
                lead={<p>Capture, Clarify, Auto-schedule, Focus. The same loop runs every day; Timely does the fitting so you don&apos;t have to.</p>}
              />
            </div>
            <LoopPinned />
          </section>

          {/* ---- 03 Docs and sheets ---- */}
          <section id="docs-and-sheets" aria-labelledby="d4-docs" className="d4-wrap pb-24 md:pb-36">
            <SectionHead
              num="03"
              label="Docs and sheets"
              color={C.blue.bg}
              headingId="d4-docs"
              title="Docs and sheets, next to the work."
              lead={
                <p>
                  Both live inside your projects and show up in search. The assistant can write a doc for you, or add
                  rows to a sheet from a photo of a receipt.
                </p>
              }
            />
            <div className="d4-cols mt-16 gap-y-16 md:mt-24">
              <div className="col-span-4 md:col-span-6 md:pr-5">
                <DocGraphic />
                <div className="mt-8">
                  <SubHead num="3.1" title="Docs">
                    <p>A block editor that speaks Markdown. Type / for headings, to-dos, tables, Mermaid diagrams, maths and callouts, and export any doc as a .md file.</p>
                  </SubHead>
                  <FeatureList items={["Markdown in and out", "Slash menu", "Mermaid diagrams", "Maths", "Callouts", "Export .md"]} />
                  <Link href="/help/notes/docs" className="d4-link mt-5 inline-flex min-h-10 items-center text-[15px] font-semibold">
                    How docs work
                  </Link>
                </div>
              </div>
              <div className="col-span-4 md:col-span-6 md:pl-5">
                <SheetGraphic />
                <div className="mt-8">
                  <SubHead num="3.2" title="Sheets">
                    <p>Budgets, trackers and lists with typed columns and real formulas, kept in the same project as the tasks they belong to.</p>
                  </SubHead>
                  <FeatureList items={["Typed columns", "Formulas", "Dropdowns and checkboxes", "Fill handle", "Tabs", "CSV export"]} />
                  <Link href="/help/notes/sheets" className="d4-link mt-5 inline-flex min-h-10 items-center text-[15px] font-semibold">
                    How sheets work
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* ---- 04 Everything else ---- */}
          <section aria-labelledby="d4-more" className="d4-wrap pb-24 md:pb-36">
            <SectionHead
              num="04"
              label="Also in Timely"
              color={C.pink.bg}
              headingId="d4-more"
              title="The rest of the week, covered."
              lead={<p>Search, a dashboard you arrange, habits and goals, four calendar views and three ways to see your tasks.</p>}
            />

            <div className="d4-cols mt-16 md:mt-24">
              <div className="col-span-4 border-t border-[var(--line-2)] py-8 md:col-span-7 md:pr-10">
                <SubHead num="4.1" title="Tasks as a list, a board or a Gantt chart" />
                <div className="mt-6">
                  <TasksMorph />
                </div>
              </div>
              <div className="col-span-4 border-t border-[var(--line-2)] py-8 md:col-span-5 md:border-l md:pl-10">
                <SubHead num="4.2" title="Day, week, month and agenda" />
                <div className="mt-6">
                  <CalendarViews />
                </div>
              </div>
              <div className="col-span-4 border-t border-[var(--line-2)] py-8 md:col-span-4 md:pr-8">
                <SubHead num="4.3" title="Search everything">
                  <p>
                    <kbd>Ctrl</kbd> <kbd>K</kbd> finds tasks, projects, docs, sheets and events, and runs commands.
                  </p>
                </SubHead>
                <div className="mt-6">
                  <SearchMini />
                </div>
              </div>
              <div className="col-span-4 border-t border-[var(--line-2)] py-8 md:col-span-4 md:border-l md:px-8">
                <SubHead num="4.4" title="A dashboard you arrange">
                  <p>Drag and resize cards: Focus time, Pomodoro, Daily journal, Habits and more.</p>
                </SubHead>
                <div className="mt-6">
                  <DashboardMini />
                </div>
              </div>
              <div className="col-span-4 border-t border-[var(--line-2)] py-8 md:col-span-4 md:border-l md:pl-8">
                <SubHead num="4.5" title="Habits and goals">
                  <p>Tick a habit each day and keep the streak; keep bigger goals in view on Today.</p>
                </SubHead>
                <div className="mt-6">
                  <HabitsMini />
                </div>
              </div>
            </div>

            <figure className="mt-12 md:mt-16">
              <Rise distance={48}>
                <div className="border border-[var(--line-2)] bg-[var(--panel)] p-1.5 sm:p-2">
                  <Image
                    src="/help/calendar.webp"
                    alt="Timely's week calendar for 11 to 17 October 2026: work blocks placed around events, and a list of work waiting for a slot."
                    width={1920}
                    height={1200}
                    sizes="(min-width: 1440px) 1344px, 100vw"
                    className="block h-auto w-full"
                  />
                </div>
              </Rise>
              <figcaption className="d4-cols mt-3 text-[13px]">
                <span className="d4-mono col-span-1 text-[var(--faint)] md:col-span-2">Fig. 4.6</span>
                <span className="col-span-3 text-[var(--soft)] md:col-span-10">The calendar in the desktop app, week view. Blocks in project colours were placed by Auto-schedule.</span>
              </figcaption>
            </figure>
          </section>

          {/* ---- 05 Private ---- */}
          <section aria-labelledby="d4-private" className="d4-wrap pb-24 md:pb-36">
            <SectionHead
              num="05"
              label="Private"
              color={C.green.bg}
              headingId="d4-private"
              title="It lives on your computer."
              lead={
                <p>
                  The desktop app bundles its own server and PostgreSQL database. Your phone pairs by QR code and reaches
                  it over your own Tailscale network. Backups are encrypted, and the code is open source.
                </p>
              }
            />
            <div className="mt-16 md:mt-24">
              <PrivateDiagram />
            </div>
          </section>

          {/* ---- 06 Download ---- */}
          <section id="download" aria-labelledby="d4-download" className="d4-wrap pb-24 md:pb-36">
            <SectionHead
              num="06"
              label="Download"
              color={C.orange.bg}
              headingId="d4-download"
              title={`Download Timely ${packageJson.version}.`}
              lead={<p>Windows, Ubuntu and Arch Linux on the computer; Android on the phone. Each platform has a step-by-step install guide.</p>}
            />
            <div className="mt-16 md:mt-24">
              <Downloads />
            </div>
          </section>

          {/* ---- Closing ---- */}
          <section aria-labelledby="d4-close" className="relative overflow-hidden">
            <div aria-hidden className="d4-wrap pt-6">
              <p className="d4-label flex justify-between text-[11px] text-[var(--soft)]">
                <span>W43 · 19–25 Oct 2026</span>
                <span>Not planned yet</span>
              </p>
              <div className="mt-3 grid h-32 grid-cols-7 border border-[var(--line-2)] md:h-44">
                {NEXT_WEEK.map((day, index) => (
                  <div key={day.short} className={cn("relative border-l border-[var(--line)] first:border-l-0", !day.color && "d4-offhours")}>
                    <span className="absolute top-2 left-1.5 z-10 flex items-baseline gap-1 sm:left-2">
                      <span className="d4-label hidden text-[10px] text-[var(--soft)] sm:inline">{day.short}</span>
                      <span className="d4-num text-[18px] sm:text-[24px]">{day.date}</span>
                    </span>
                    {day.color ? (
                      <Wipe axis="y" color={C[day.color].bg} delay={index * 0.08} className="absolute inset-x-[3px] bottom-[3px]" style={{ height: `${day.fill * 100}%` }} />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="d4-wrap py-16 md:py-24">
              <KineticHeading id="d4-close" className="text-[clamp(3.2rem,10vw,10rem)] leading-[0.86] tracking-[-0.055em]" from={200} to={830}>
                Give next week
                <br />a plan.
              </KineticHeading>
              <div className="d4-cols mt-10 gap-y-6">
                <p className="d4-lead col-span-4 md:col-span-5 md:pr-10">Create an account on your Timely server, capture what is on your mind, and let it find the time.</p>
                <Cta className="col-span-4 md:col-span-7 md:justify-end" />
              </div>
            </div>
          </section>
        </main>
        <Footer />
      </MotionRoot>
    </div>
  );
}
