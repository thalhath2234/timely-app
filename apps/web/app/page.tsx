import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import packageJson from "@/package.json";
import AiShowcase from "@/app/_components/landing/aiShowcase";
import DocsSheetsShowcase from "@/app/_components/landing/docsSheetsShowcase";
import Downloads from "@/app/_components/landing/downloads";
import { DashboardGraphic, HabitsGraphic, ScheduleGraphic, SearchGraphic } from "@/app/_components/landing/featureGraphics";
import HeroFlow from "@/app/_components/landing/heroFlow";
import LoopStory from "@/app/_components/landing/loopStory";
import NowMarker from "@/app/_components/landing/nowMarker";
import { FeatureBlock, Reveal } from "@/app/_components/landing/reveal";
import SyncDiagram from "@/app/_components/landing/syncDiagram";
import { LATEST_RELEASE_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { displayFont } from "@/app/_components/site/displayFont";
import { SiteMotion } from "@/app/_components/site/motion";
import SiteFooter from "@/app/_components/site/siteFooter";
import SiteHeader from "@/app/_components/site/siteHeader";
import { cn } from "@/app/utils/cn";
import "@/app/_components/site/site.css";

const TITLE = "Timely: write it down, Timely finds the time";
const DESCRIPTION =
  "A private planner with an AI assistant that runs on the Claude or ChatGPT subscription you already have. Capture a thought and Timely places it on your week, with smart suggestions, docs, sheets and an MCP server for your own agents. Open source, for Windows, Linux and Android.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Timely" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/**
 * One block of the day. It starts at `time` on the hour gutter, carries a
 * calendar-block label in its project colour, and holds one part of the page.
 */
function Hour({
  id,
  time,
  end,
  color,
  label,
  title,
  body,
  children,
}: {
  id?: string;
  time: string;
  end: string;
  color: string;
  label: string;
  title: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} data-hour={time} className="relative grid border-t border-[var(--lp-line)] lg:grid-cols-[104px_minmax(0,1fr)]">
      <p data-hour-label className="lp-mono hidden pt-4 text-sm text-[var(--lp-faint)] transition-opacity duration-200 lg:block">
        {time}
      </p>
      <div className="min-w-0 pt-6 pb-24 lg:pt-4 lg:pb-32">
        <Reveal>
          <p className="lp-block inline-flex items-center gap-2 py-1 pr-2.5 pl-2 text-xs" style={{ "--c": color } as React.CSSProperties}>
            <span className="lp-mono text-[var(--lp-soft)]">
              {time}–{end}
            </span>
            <span className="font-semibold text-[var(--lp-ink)]">{label}</span>
          </p>
          <h2 className="lp-display mt-5 max-w-[16ch] text-[2.6rem] leading-[0.95] sm:text-6xl lg:text-[4.5rem]">{title}</h2>
          {body ? <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-[var(--lp-soft)] sm:text-lg">{body}</p> : null}
        </Reveal>
        {children}
      </div>
    </section>
  );
}

function Cta({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
      <Link href="/signup" className="lp-btn lp-btn-primary">
        Register
        <ArrowRight className="size-4" />
      </Link>
      <Link href="/login" className="lp-btn lp-btn-ghost">
        Log in
      </Link>
      <a href={REPO_URL} className="lp-btn lp-btn-ghost">
        <GitHubMark className="size-4" />
        GitHub
      </a>
    </div>
  );
}

export default function Home() {
  return (
    <div className={cn("site lp", displayFont.variable)}>
      <SiteMotion>
        <SiteHeader />

        <main id="main-content">
          {/* Hero: the first thing in the day view is the date. */}
          <section className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-8 sm:pt-16 lg:pt-20">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--lp-line)] pb-3">
              <p className="lp-mono text-xs tracking-wide text-[var(--lp-faint)] uppercase">Mon 12 Oct · Week 42</p>
              <a
                href={LATEST_RELEASE_URL}
                className="lp-mono flex items-center gap-1.5 text-xs text-[var(--lp-soft)] transition-colors hover:text-[var(--lp-ink)]"
              >
                <span className="size-1.5 rounded-full bg-[var(--lp-green)]" />
                v{packageJson.version} · Windows, Linux, Android
                <ArrowUpRight className="size-3.5" />
              </a>
            </div>

            <h1 className="lp-display mt-10 text-[3.4rem] leading-[0.92] sm:text-[6rem] lg:text-[8.25rem]">
              Write it down.
              <br />
              Timely finds{" "}
              <span className="lp-hero-block">
                <small>10:00–11:30</small>
                the time.
              </span>
            </h1>

            <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <p className="max-w-[46ch] text-lg leading-relaxed text-[var(--lp-soft)]">
                Capture a thought and Timely places it on your week, around your meetings and inside your working
                hours. The assistant runs on the <span className="text-[var(--lp-ink)]">Claude or ChatGPT subscription</span>{" "}
                you already pay for, and everything stays on your own computer.
              </p>
              <Cta />
            </div>

            <Reveal delay={0.2} className="mt-14">
              <HeroFlow />
            </Reveal>
          </section>

          {/* The day: hour gutter, a now marker, and one block per part of the page. */}
          <div className="relative mx-auto max-w-6xl px-4 sm:px-8">
            <div aria-hidden className="lp-ticks pointer-events-none absolute top-0 bottom-0 left-4 hidden w-[88px] opacity-60 sm:left-8 lg:block" />
            <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 left-4 hidden w-[100px] sm:left-8 lg:block">
              <NowMarker />
            </div>

            <Hour
              id="how-it-works"
              time="09:00"
              end="10:30"
              color="var(--lp-violet)"
              label="How it works"
              title="One loop, from the first thought to done."
              body="Timely is built around four steps. You decide what matters and how long it takes. Timely does the arranging."
            >
              <LoopStory />
            </Hour>

            <Hour
              id="ai"
              time="11:00"
              end="12:30"
              color="var(--lp-pink)"
              label="AI, your way"
              title="Bring the AI you already pay for."
              body="Sign in with your Claude or ChatGPT subscription, or pick any model with your own key. The assistant plans, smart suggestions fill in the details, and your own agents plug straight in."
            >
              <AiShowcase />
            </Hour>

            <Hour
              id="docs-and-sheets"
              time="13:30"
              end="14:45"
              color="var(--lp-amber)"
              label="Docs and sheets"
              title="Notes and numbers, next to the work."
              body="Every project can hold its own docs and sheets. Search finds them, the assistant writes and fills them, and nothing lives in a separate app."
            >
              <DocsSheetsShowcase />
            </Hour>

            <Hour
              id="features"
              time="15:00"
              end="16:00"
              color="var(--lp-blue)"
              label="The rest of your day"
              title="Plan, focus and keep track in one place."
            >
              <div className="mt-14 grid gap-x-8 gap-y-14 md:grid-cols-2">
                <FeatureBlock
                  color="var(--lp-violet)"
                  title="Your calendar rearranges itself"
                  body="Work lands in free time inside your working hours. When a meeting appears, the next run moves what it overlaps. Pins and manual blocks stay put."
                  graphic={<ScheduleGraphic />}
                  href="/help/plan/auto-schedule"
                />
                <FeatureBlock
                  delay={0.06}
                  color="var(--lp-cyan)"
                  title="Find anything, run any command"
                  body="Press Ctrl/Cmd+K to search tasks, projects, docs, sheets and events, or create something new from the same box."
                  graphic={<SearchGraphic />}
                  href="/help/notes/search"
                />
                <FeatureBlock
                  color="var(--lp-orange)"
                  title="A dashboard you arrange yourself"
                  body="Drag and resize cards for focus time, deadlines, a Pomodoro timer, a journal and more. Your layout is saved."
                  graphic={<DashboardGraphic />}
                  href="/help/notes/dashboard"
                />
                <FeatureBlock
                  delay={0.06}
                  color="var(--lp-green)"
                  title="Habits and goals, kept in view"
                  body="Tick habits on Today or on your phone's Home screen and watch the streak grow next to your goals."
                  graphic={<HabitsGraphic />}
                  graphicClassName="flex items-center"
                  href="/help/plan/today"
                />
              </div>
            </Hour>

            <Hour
              id="private"
              time="16:30"
              end="17:00"
              color="var(--lp-green)"
              label="Private by design"
              title="Runs on your computer. Reaches your phone."
              body="The desktop app brings its own server and database. Your phone pairs with it by QR code and connects over your own Tailscale network. Nothing goes to someone else's cloud."
            >
              <Reveal className="mt-14">
                <SyncDiagram />
              </Reveal>
              <dl className="mt-14 grid gap-x-8 gap-y-6 sm:grid-cols-3">
                {[
                  {
                    title: "Your data stays home",
                    body: "The database lives in your app data folder. The server listens on this computer only unless you turn on Tailscale access.",
                  },
                  {
                    title: "Your own AI account",
                    body: "The assistant runs on your Claude or ChatGPT sign-in, or your own API key, stored encrypted. Without one, everything else still works.",
                  },
                  {
                    title: "Backups built in",
                    body: "Encrypted account backups on a schedule, a full JSON export, and an automatic copy before every upgrade.",
                  },
                ].map((point) => (
                  <div key={point.title} className="border-t border-[var(--lp-line)] pt-4">
                    <dt className="font-semibold">{point.title}</dt>
                    <dd className="mt-1.5 text-sm leading-relaxed text-[var(--lp-soft)]">{point.body}</dd>
                  </div>
                ))}
              </dl>
            </Hour>

            <Hour
              id="download"
              time="17:00"
              end="17:30"
              color="var(--lp-cyan)"
              label="Install"
              title="Set it up before the end of the day."
              body="Every release ships a Windows installer, a Linux AppImage and an Android app. The help center walks through each one."
            >
              <Downloads />
            </Hour>

            <Hour
              time="18:00"
              end="18:15"
              color="var(--lp-now)"
              label="Plan tomorrow"
              title="Close the laptop. Tomorrow is already planned."
            >
              <Reveal className="mt-10">
                <Cta />
                <p className="mt-6 text-sm text-[var(--lp-soft)]">
                  New here? Start with{" "}
                  <Link href="/help/start/what-is-timely" className="text-[var(--lp-now)] underline-offset-4 hover:underline">
                    What is Timely?
                  </Link>{" "}
                  in the help center.
                </p>
              </Reveal>
            </Hour>
          </div>
        </main>

        <SiteFooter />
      </SiteMotion>
    </div>
  );
}
