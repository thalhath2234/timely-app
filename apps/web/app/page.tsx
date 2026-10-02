import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import Link from "next/link";
import { ArrowUpRight, MousePointerClick } from "lucide-react";
import FeatureIndex from "@/app/_components/landing/featureIndex";
import GitHubMark from "@/app/_components/landing/githubMark";
import Header from "@/app/_components/landing/header";
import { hueStyle } from "@/app/_components/landing/hue";
import InlineScript from "@/app/_components/landing/inlineScript";
import { landingThemeScript } from "@/app/_components/landing/landingTheme";
import { LOOP_STEPS } from "@/app/_components/landing/loopSteps";
import QuickStart from "@/app/_components/landing/quickStart";
import { MCP_TOOL_COUNT, REPO_URL } from "@/app/_components/landing/sampleData";
import { ReducedMotionGate } from "@/app/_components/landing/scene";
import AssistantScene from "@/app/_components/landing/scenes/assistantScene";
import AutoScheduleScene from "@/app/_components/landing/scenes/autoScheduleScene";
import CaptureScene from "@/app/_components/landing/scenes/captureScene";
import ClarifyScene from "@/app/_components/landing/scenes/clarifyScene";
import DocsSheetsScene from "@/app/_components/landing/scenes/docsSheetsScene";
import EverywhereScene from "@/app/_components/landing/scenes/everywhereScene";
import FocusScene from "@/app/_components/landing/scenes/focusScene";
import HeroScene from "@/app/_components/landing/scenes/heroScene";
import ReviewScene from "@/app/_components/landing/scenes/reviewScene";
import SearchScene from "@/app/_components/landing/scenes/searchScene";
import { Section, Stage } from "@/app/_components/landing/section";
import { Shape, Sticker } from "@/app/_components/landing/stickers";
import "@/app/_components/landing/landing.css";

const display = Bricolage_Grotesque({
  variable: "--font-landing-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

const TITLE = "Timely — From loose thoughts to a planned week";
const DESCRIPTION =
  "Capture a thought, decide what it is, and let Timely place it on your calendar. A private, single-user planner with tasks, docs, sheets and an assistant. Open source, for desktop and Android.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Timely" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/** The anchor, colour, label and number of one step of the loop, for its section. */
function loopStep(id: (typeof LOOP_STEPS)[number]["id"]) {
  const index = LOOP_STEPS.findIndex((step) => step.id === id);
  return { ...LOOP_STEPS[index], step: index + 1 };
}

function GetTheCode({ className = "" }: { className?: string }) {
  return (
    <a
      href={REPO_URL}
      className={`l-button inline-flex h-12 items-center gap-2.5 rounded-full px-6 text-base font-semibold ${className}`}
    >
      <GitHubMark className="size-5" />
      Get the code
    </a>
  );
}

function TryIt({ children }: { children: string }) {
  return (
    <p className="l-label mt-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium">
      <MousePointerClick className="size-4 shrink-0" />
      {children}
    </p>
  );
}

export default function Home() {
  return (
    <div className={`landing ${display.variable}`}>
      <InlineScript html={landingThemeScript} />
      <ReducedMotionGate />
      <Header />

      <main id="main-content">
        <section className="l-hue relative overflow-x-clip" style={hueStyle("#6E56CF")}>
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pt-12 pb-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-20 lg:pb-24">
            <div>
              <p className="l-label inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-wide">
                An open-source personal planner
              </p>
              <h1 className="l-display mt-5 text-[2.75rem] leading-[1.02] font-extrabold text-balance sm:text-6xl lg:text-[4.25rem]">
                From loose thoughts to a planned week.
              </h1>
              <p className="l-soft mt-6 max-w-lg text-lg leading-relaxed">
                Capture a thought, decide what it is, and let Timely place it on your calendar. Private,
                single-user, open source.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-4">
                <GetTheCode />
                <span className="l-soft text-sm">Desktop and Android, built from source.</span>
              </div>
            </div>
            <Stage
              sticker="sparkle"
              shapes={[
                { name: "blob", hue: "#E93D82", className: "-left-8 -top-8 size-24 sm:-left-12 sm:size-32", tilt: 12 },
                { name: "squiggle", hue: "#FFB224", className: "-bottom-7 right-8 w-28 sm:w-36" },
                { name: "plus", hue: "#30A66D", className: "-bottom-4 -left-3 size-9 sm:size-11", tilt: 14 },
              ]}
            >
              <HeroScene />
            </Stage>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 pt-10 pb-2 text-center sm:px-8 lg:pt-16">
          <h2 className="l-display text-3xl font-bold text-balance sm:text-4xl">One loop, five steps.</h2>
          <p className="l-soft mt-4 text-base leading-relaxed sm:text-lg">
            Timely is built around a single habit. Each step has its own screen, shown below with the same
            sample project all the way through.
          </p>
          <ol className="mt-7 flex flex-wrap justify-center gap-2">
            {LOOP_STEPS.map((step, index) => (
              <li key={step.id}>
                <a
                  href={`#${step.id}`}
                  style={hueStyle(step.hue)}
                  className="l-hue l-label flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                >
                  <span className="font-mono tabular-nums opacity-70">{index + 1}</span>
                  {step.label}
                </a>
              </li>
            ))}
          </ol>
        </section>

        <Section
          {...loopStep("capture")}
          headline="Get it out of your head in one line."
          body="The Inbox takes a title and nothing else. No project, no date, no decisions. Those come later, when you have a minute to think."
          points={[
            "Type it on the desktop, or tap + on the phone.",
            "Inbox items are never placed on your calendar by accident.",
          ]}
          sticker="tray"
          shapes={[
            { name: "ring", hue: "#0090FF", className: "-bottom-6 -left-5 size-14 sm:size-20" },
            { name: "pill", hue: "#E93D82", className: "-top-5 left-10 w-16 sm:w-24", tilt: -8 },
          ]}
        >
          <CaptureScene />
        </Section>

        <Section
          {...loopStep("clarify")}
          headline="Decide what it is: work to do, or a nudge at the right time."
          body="Clarify replaces an Inbox item with Work, which has a duration and a workspace, or with a Reminder, which has a time. Work can be placed on your calendar. A Reminder just pings you and takes up no time."
          flip
          sticker="bell"
          shapes={[
            { name: "dots", hue: "#6E56CF", className: "-right-5 -bottom-6 size-16 sm:size-20" },
            { name: "squiggle", hue: "#30A66D", className: "-top-6 right-10 w-24 sm:w-32", tilt: 6 },
          ]}
        >
          <ClarifyScene />
        </Section>

        <Section
          {...loopStep("schedule")}
          headline="Let Timely find the time."
          body="Auto-schedule places your Work inside your Working hours, around the Events you already have. Preview what would change, apply it, and undo it if you disagree."
          points={[
            "Orders work by deadline, priority and what is blocking what.",
            "Says in plain language why something could not be placed.",
            "Events and blocks you placed yourself stay where they are.",
          ]}
          extra={<TryIt>Press Auto-schedule in the demo.</TryIt>}
          sticker="calendar"
          shapes={[
            { name: "blob", hue: "#FFB224", className: "-bottom-8 -left-8 size-20 sm:size-28", tilt: -20 },
            { name: "plus", hue: "#E93D82", className: "-top-5 left-12 size-8 sm:size-10", tilt: 20 },
          ]}
        >
          <AutoScheduleScene />
        </Section>

        <Section
          {...loopStep("focus")}
          label="Focus and Today"
          headline="One list for today. One thing at a time."
          body="Today shows what is on your calendar, what you chose to focus on and what is still waiting. Start a focus session and Timely counts the real minutes against your estimate."
          flip
          sticker="stopwatch"
          shapes={[
            { name: "ring", hue: "#FFB224", className: "-right-6 -bottom-6 size-16 sm:size-20" },
            { name: "pill", hue: "#0090FF", className: "-top-5 right-12 w-16 sm:w-24", tilt: 10 },
          ]}
        >
          <FocusScene />
        </Section>

        <Section
          {...loopStep("review")}
          headline="See how the week actually went."
          body="The report is worked out from your live data: what got done, what is still open by priority, what is due in the next two weeks and what is overdue. Overdue means the deadline has passed; a block that merely ended does not count."
          sticker="chart"
          shapes={[
            { name: "squiggle", hue: "#E93D82", className: "-bottom-7 left-8 w-24 sm:w-32", tilt: -4 },
            { name: "dots", hue: "#30A66D", className: "-top-6 -left-5 size-14 sm:size-16" },
          ]}
        >
          <ReviewScene />
        </Section>

        <section className="mx-auto max-w-3xl px-5 pt-10 pb-2 text-center sm:px-8 lg:pt-16">
          <h2 className="l-display text-3xl font-bold text-balance sm:text-4xl">And around the loop.</h2>
          <p className="l-soft mt-4 text-base leading-relaxed sm:text-lg">
            An assistant, a place to write, a place to calculate, and one shortcut that finds all of it.
          </p>
        </section>

        <Section
          id="assistant"
          hue="#AB4ABA"
          label="Ask the assistant"
          headline="Ask in plain words. Review bigger changes before they apply."
          body="The assistant reads your workspace and answers with a proposal: a list of changes you can inspect, apply or discard. A simple one-step change is applied directly; anything bigger waits for your approval."
          points={[
            "Photograph a receipt and it becomes rows in an expense sheet.",
            "Bring your own model: OpenRouter, Claude Code or Codex.",
            "A run keeps going on the server if you leave the chat.",
          ]}
          extra={<TryIt>Press Apply changes in the demo.</TryIt>}
          flip
          sticker="chat"
          shapes={[
            { name: "blob", hue: "#12A594", className: "-right-8 -bottom-8 size-20 sm:size-28", tilt: 30 },
            { name: "plus", hue: "#FFB224", className: "-top-5 right-12 size-8 sm:size-10", tilt: 12 },
          ]}
        >
          <AssistantScene />
        </Section>

        <Section
          id="docs-and-sheets"
          hue="#12A594"
          label="Docs and Sheets"
          headline="Notes and numbers live next to the work."
          body="Nested docs with a slash menu and @ mentions that link to tasks, projects and sheets. Multi-tab sheets with formulas, formatting and reusable templates."
          sticker="pencil"
          shapes={[
            { name: "ring", hue: "#E93D82", className: "-bottom-6 -left-6 size-16 sm:size-20" },
            { name: "pill", hue: "#FFB224", className: "-top-5 left-10 w-16 sm:w-24", tilt: 6 },
          ]}
        >
          <DocsSheetsScene />
        </Section>

        <Section
          id="search"
          hue="#F76808"
          label="Find anything"
          headline="One shortcut to everything."
          body="Ctrl or ⌘ K searches sheets, docs, tasks, projects and events, and runs commands such as “create task”. Keyword search works out of the box. Add an OpenRouter key and it also searches by meaning."
          extra={
            <Link
              href="/demo/command-palette"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold underline decoration-2 underline-offset-4"
              style={{ color: "var(--l-hue-ink)" }}
            >
              Try the real command palette
              <ArrowUpRight className="size-4" />
            </Link>
          }
          flip
          sticker="magnifier"
          shapes={[
            { name: "dots", hue: "#0090FF", className: "-right-5 -bottom-6 size-16 sm:size-20" },
            { name: "squiggle", hue: "#6E56CF", className: "-top-6 right-10 w-24 sm:w-32" },
          ]}
        >
          <SearchScene />
        </Section>

        <Section
          id="everywhere"
          hue="#3E63DD"
          label="Everywhere"
          headline="On your desk, in your pocket, in your agent’s hands."
          body={`Desktop and Android apps, built from source, share one account. Any MCP agent can work with the same data through ${MCP_TOOL_COUNT} tools, using a personal API key you can revoke.`}
          sticker="phone"
          shapes={[
            { name: "blob", hue: "#30A66D", className: "-bottom-8 -left-8 size-20 sm:size-28", tilt: 50 },
            { name: "plus", hue: "#E93D82", className: "-top-5 left-12 size-8 sm:size-10", tilt: 20 },
          ]}
        >
          <EverywhereScene />
        </Section>

        <section id="everything-else" className="l-hue relative overflow-x-clip" style={hueStyle("#99D52A")}>
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-24">
            <div className="relative mx-auto max-w-2xl text-center">
              <Sticker name="star" tilt={-10} className="-top-10 left-2 size-14 sm:left-0 sm:size-16" />
              <Shape name="squiggle" className="-top-6 right-0 w-20 sm:w-28" style={hueStyle("#0090FF")} tilt={8} />
              <Shape name="plus" className="right-6 -bottom-9 size-7 sm:size-9" style={hueStyle("#E93D82")} tilt={16} />
              <p className="l-label relative inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-wide">
                Everything else
              </p>
              <h2 className="l-display relative mt-4 text-3xl leading-[1.08] font-bold text-balance sm:text-4xl lg:text-[2.75rem]">
                The rest of what is in the box.
              </h2>
            </div>
            <div className="mt-10">
              <FeatureIndex />
            </div>
          </div>
        </section>

        <section id="get-the-code" className="l-hue relative overflow-x-clip" style={hueStyle("#6E56CF")}>
          <div className="relative mx-auto max-w-3xl px-5 pt-6 pb-20 text-center sm:px-8 lg:pb-28">
            <Shape name="blob" className="-top-2 left-2 size-16 sm:left-0 sm:size-24" style={hueStyle("#FFB224")} tilt={18} />
            <Shape name="ring" className="top-10 right-3 size-12 sm:right-0 sm:size-16" style={hueStyle("#30A66D")} />
            <Sticker name="sparkle" tilt={12} className="top-0 right-16 size-14 sm:right-24 sm:size-16" style={hueStyle("#E93D82")} />
            <h2 className="l-display relative pt-16 text-4xl leading-[1.05] font-extrabold text-balance sm:text-5xl">
              Run it yourself.
            </h2>
            <p className="l-soft relative mx-auto mt-4 max-w-xl text-base leading-relaxed sm:text-lg">
              Timely is a personal project you host on your own machine. Three commands start it. You need
              Node 22, Go 1.25 and PostgreSQL with pgvector; the README has the details.
            </p>
            <div className="relative mt-8">
              <QuickStart />
            </div>
            <div className="relative mt-9 flex flex-col items-center gap-5">
              <GetTheCode />
              <p className="l-soft text-sm">
                Already running it?{" "}
                <Link href="/login" className="font-semibold text-[var(--l-ink)] underline underline-offset-4">
                  Sign In
                </Link>{" "}
                or{" "}
                <Link href="/signup" className="font-semibold text-[var(--l-ink)] underline underline-offset-4">
                  Register
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: "var(--l-line)" }}>
        <div className="l-soft mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm sm:flex-row sm:px-8">
          <span>An open-source personal project.</span>
          <a href={REPO_URL} className="inline-flex items-center gap-2 font-medium hover:text-[var(--l-ink)]">
            <GitHubMark className="size-4" />
            thalhath2234/timely-app
          </a>
        </div>
      </footer>
    </div>
  );
}
