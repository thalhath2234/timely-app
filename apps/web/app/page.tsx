import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Download, KeyRound, LifeBuoy, ShieldCheck, Sparkles, Star } from "lucide-react";
import packageJson from "@/package.json";
import Downloads from "@/app/_components/landing/downloads";
import AiShowcase from "@/app/_components/landing/aiShowcase";
import DocsSheetsShowcase from "@/app/_components/landing/docsSheetsShowcase";
import {
  DashboardGraphic,
  HabitsGraphic,
  ScheduleGraphic,
  SearchGraphic,
} from "@/app/_components/landing/featureGraphics";
import HeroFlow from "@/app/_components/landing/heroFlow";
import LoopStory from "@/app/_components/landing/loopStory";
import { FeatureCard, Reveal } from "@/app/_components/landing/reveal";
import SyncDiagram from "@/app/_components/landing/syncDiagram";
import { LATEST_RELEASE_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { SiteMotion } from "@/app/_components/site/motion";
import SiteFooter from "@/app/_components/site/siteFooter";
import SiteHeader from "@/app/_components/site/siteHeader";
import "@/app/_components/site/site.css";

const TITLE = "Timely: from loose thoughts to a planned week";
const DESCRIPTION =
  "A private planner with an AI assistant that runs on the Claude or ChatGPT subscription you already have. Capture a thought and Timely plans it into your week, with smart suggestions, docs, sheets and an MCP server for your own agents. Open source, for Windows, Linux and Android.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Timely" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const PROOF = [
  "Your Claude subscription",
  "Your ChatGPT subscription",
  "Smart suggestions",
  "AI agents over MCP",
  "Auto-schedule",
  "Inbox and Clarify",
  "Week calendar",
  "Projects and stages",
  "List, board and Gantt",
  "Docs with Markdown",
  "Sheets with formulas",
  "Habits and goals",
  "Pomodoro",
  "Receipts to sheets",
  "Encrypted backups",
  "Phone pairing",
];

function SectionHeading({
  id,
  eyebrow,
  title,
  body,
}: {
  id?: string;
  eyebrow: string;
  title: React.ReactNode;
  body?: string;
}) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p id={id} className="text-sm font-semibold text-[var(--s-primary)]">
        {eyebrow}
      </p>
      <h2 className="s-display mt-3 text-[2rem] leading-[1.08] font-semibold text-balance sm:text-5xl">{title}</h2>
      {body ? <p className="s-soft mx-auto mt-4 max-w-xl text-base leading-relaxed sm:text-lg">{body}</p> : null}
    </Reveal>
  );
}

export default function Home() {
  return (
    <div className="site">
      <SiteMotion>
        <SiteHeader />

        <main id="main-content">
          {/* Hero */}
          <section className="relative overflow-x-clip">
            <div aria-hidden className="pointer-events-none absolute inset-0 -top-16">
              <div className="s-grid absolute inset-0" />
              <div className="s-orb top-[-8%] left-[12%] size-[420px] bg-[#6f6ff0]" />
              <div className="s-orb top-[18%] right-[6%] size-[360px] bg-[#c26bf0]" style={{ animationDelay: "-6s" }} />
              <div className="s-orb top-[48%] left-[38%] size-[300px] bg-[#2f8ad8] opacity-35" style={{ animationDelay: "-11s" }} />
              <svg className="absolute inset-x-0 top-[22%] h-[60%] w-full opacity-70" viewBox="0 0 1200 500" preserveAspectRatio="none" fill="none">
                {[
                  "M-20 80 C 300 80, 420 260, 600 300 S 980 200, 1220 240",
                  "M-20 420 C 260 400, 420 300, 600 300 S 920 420, 1220 380",
                  "M-20 250 C 240 250, 400 290, 600 300 S 960 300, 1220 120",
                ].map((d, index) => (
                  <g key={d}>
                    <path d={d} stroke="rgb(255 255 255 / 5%)" strokeWidth="1" />
                    <path
                      d={d}
                      className="s-beam"
                      pathLength={1}
                      stroke={["#c0c1ff", "#f0abfc", "#7cc4ff"][index]}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      style={{ animationDelay: `${index * -1.8}s`, animationDuration: `${6 + index}s` }}
                    />
                  </g>
                ))}
              </svg>
            </div>

            <div className="relative mx-auto max-w-6xl px-4 pt-14 pb-20 sm:px-8 sm:pt-20 lg:pt-24">
              <div className="mx-auto max-w-3xl text-center">
                <Reveal>
                  <a
                    href={LATEST_RELEASE_URL}
                    className="s-eyebrow rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors hover:text-[var(--s-ink)]"
                  >
                    <span className="size-1.5 rounded-full bg-[var(--s-green)] shadow-[0_0_10px_var(--s-green)]" />
                    v{packageJson.version} is out · Windows, Linux and Android
                    <ArrowRight className="size-3.5" />
                  </a>
                </Reveal>
                <Reveal delay={0.08}>
                  <h1 className="s-display mt-7 text-[2.6rem] leading-[1.02] font-semibold text-balance sm:text-6xl lg:text-[4.6rem]">
                    From loose thoughts to a <span className="s-gradient-text">planned week.</span>
                  </h1>
                </Reveal>
                <Reveal delay={0.16}>
                  <p className="s-soft mx-auto mt-6 max-w-xl text-lg leading-relaxed">
                    Capture a thought and Timely plans it into your week, with an AI assistant that runs on the
                    Claude or ChatGPT subscription you already pay for. Private, on your own computer.
                  </p>
                </Reveal>
                <Reveal delay={0.24}>
                  <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                    <Link
                      href="/signup"
                      className="s-btn-primary inline-flex h-12 items-center gap-2 rounded-full px-6 text-base font-semibold"
                    >
                      Register
                      <ArrowRight className="size-4" />
                    </Link>
                    <Link
                      href="/login"
                      className="s-btn-ghost inline-flex h-12 items-center rounded-full px-6 text-base font-semibold"
                    >
                      Log in
                    </Link>
                    <a
                      href={REPO_URL}
                      className="s-btn-ghost inline-flex h-12 items-center gap-2 rounded-full px-5 text-base font-semibold"
                    >
                      <GitHubMark className="size-[1.1rem]" />
                      GitHub
                    </a>
                  </div>
                  <p className="s-faint mt-4 text-sm">
                    Free and open source.{" "}
                    <a href="#download" className="underline-offset-4 hover:text-[var(--s-soft)] hover:underline">
                      Download the desktop app
                    </a>{" "}
                    to run it yourself.
                  </p>
                </Reveal>
              </div>

              <Reveal delay={0.3} className="mx-auto mt-14 max-w-5xl sm:mt-16">
                <HeroFlow />
              </Reveal>
            </div>
          </section>

          {/* Feature marquee */}
          <section aria-label="What is in Timely" className="border-y border-[var(--s-line)] py-5">
            <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
              <ul className="s-marquee flex w-max gap-3">
                {[...PROOF, ...PROOF].map((item, index) => (
                  <li
                    key={`${item}-${index}`}
                    aria-hidden={index >= PROOF.length || undefined}
                    className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-4 py-1.5 text-sm whitespace-nowrap text-[var(--s-soft)]"
                  >
                    <Sparkles className="size-3.5 text-[var(--s-primary)]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* AI */}
          <section className="relative overflow-x-clip">
            <div aria-hidden className="s-orb top-[20%] left-[-12%] size-[420px] bg-[#6f6ff0] opacity-25" />
            <div aria-hidden className="s-orb top-[45%] right-[-14%] size-[420px] bg-[#c26bf0] opacity-20" style={{ animationDelay: "-9s" }} />
            <div className="relative mx-auto max-w-6xl px-4 py-24 sm:px-8 lg:py-32">
              <SectionHeading
                id="ai"
                eyebrow="AI, your way"
                title={
                  <>
                    Bring the AI you <span className="s-gradient-text">already pay for.</span>
                  </>
                }
                body="Sign in with your Claude or ChatGPT subscription, or pick any model with your own key. The assistant plans, smart suggestions fill in the details, and your own agents plug straight in."
              />
              <AiShowcase />
            </div>
          </section>

          {/* How it works */}
          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-8 lg:pb-32">
            <SectionHeading
              id="how-it-works"
              eyebrow="How it works"
              title="One loop, from the first thought to done."
              body="Timely is built around four steps. You do the deciding; it does the arranging."
            />
            <LoopStory />
          </section>

          {/* Docs and sheets */}
          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-8 lg:pb-32">
            <SectionHeading
              id="docs-and-sheets"
              eyebrow="Docs and sheets"
              title="Notes and numbers, right next to the work."
              body="Every project can hold its own docs and sheets. Search finds them, the assistant writes and fills them, and nothing lives in a separate app."
            />
            <DocsSheetsShowcase />
          </section>

          {/* Features */}
          <section className="relative mx-auto max-w-6xl px-4 pb-24 sm:px-8 lg:pb-32">
            <SectionHeading
              id="features"
              eyebrow="Everything in one place"
              title="Plan, focus and track without switching apps."
              body="Tasks, a calendar, a dashboard and habits share one search and one set of projects."
            />
            <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                className="lg:col-span-2"
                graphicClassName="h-52"
                eyebrow="Auto-schedule"
                title="Your calendar rearranges itself."
                body="Work lands in free time inside your working hours. When a meeting appears, the next run moves what it overlaps. Pins and manual blocks stay put."
                graphic={<ScheduleGraphic />}
                href="/help/plan/auto-schedule"
              />
              <FeatureCard
                delay={0.06}
                eyebrow="Search"
                title="Find anything, run any command."
                body="Press Ctrl/Cmd+K to search tasks, projects, docs, sheets and events, or create something new from the same box."
                graphic={<SearchGraphic />}
                href="/help/notes/search"
              />
              <FeatureCard
                eyebrow="Dashboard"
                title="Cards you arrange yourself."
                body="Drag and resize cards for focus time, deadlines, a Pomodoro timer, a journal and more. Your layout is saved."
                graphic={<DashboardGraphic />}
                href="/help/notes/dashboard"
              />
              <FeatureCard
                delay={0.06}
                className="lg:col-span-2"
                eyebrow="Habits and goals"
                title="Small streaks, kept in view."
                body="Tick habits on Today or on your phone's Home screen and watch the streak grow next to your goals."
                graphic={<HabitsGraphic />}
                graphicClassName="flex items-center"
                href="/help/plan/today"
              />
            </div>
          </section>

          {/* Desktop + phone */}
          <section className="relative overflow-x-clip border-y border-[var(--s-line)] bg-[#0d0e13]">
            <div aria-hidden className="s-orb top-[10%] left-[-10%] size-[380px] bg-[#4edea3] opacity-20" />
            <div className="relative mx-auto max-w-6xl px-4 py-24 sm:px-8 lg:py-28">
              <SectionHeading
                eyebrow="Private by design"
                title="Runs on your computer. Reaches your phone."
                body="The desktop app brings its own server and database. Your phone pairs with it by QR code and connects over your own Tailscale network. Nothing goes to someone else's cloud."
              />
              <Reveal className="mt-14">
                <SyncDiagram />
              </Reveal>
              <div className="mt-14 grid gap-4 sm:grid-cols-3">
                {[
                  {
                    icon: ShieldCheck,
                    title: "Your data stays home",
                    body: "The database lives in your app data folder. The server listens on this computer only unless you turn on Tailscale access.",
                  },
                  {
                    icon: KeyRound,
                    title: "Bring your own keys",
                    body: "The assistant runs on your own Claude or ChatGPT sign-in, or your own API key, stored encrypted. Without one, everything else still works.",
                  },
                  {
                    icon: Download,
                    title: "Backups built in",
                    body: "Encrypted account backups on a schedule, a full JSON export, and an automatic copy before every upgrade.",
                  },
                ].map((point, index) => (
                  <Reveal key={point.title} delay={index * 0.08} className="s-card rounded-2xl p-5">
                    <point.icon className="size-5 text-[var(--s-primary)]" />
                    <h3 className="mt-3 font-semibold">{point.title}</h3>
                    <p className="s-soft mt-1.5 text-sm leading-relaxed">{point.body}</p>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>

          {/* Download */}
          <section className="mx-auto max-w-6xl px-4 py-24 sm:px-8 lg:py-32">
            <SectionHeading
              id="download"
              eyebrow="Download"
              title="Install it in a couple of minutes."
              body="Every release ships a Windows installer, a Linux AppImage and an Android app. The help center walks through each one."
            />
            <Downloads />
          </section>

          {/* Closing call to action */}
          <section className="px-4 pb-24 sm:px-8 lg:pb-32">
            <Reveal className="relative mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-[#111319] px-6 py-16 text-center sm:px-12">
              <div aria-hidden className="s-orb top-[-40%] left-[20%] size-[420px] bg-[#6f6ff0] opacity-40" />
              <div aria-hidden className="s-orb bottom-[-50%] right-[10%] size-[380px] bg-[#c26bf0] opacity-30" style={{ animationDelay: "-7s" }} />
              <div className="relative">
                <h2 className="s-display text-3xl font-semibold text-balance sm:text-5xl">Plan next week tonight.</h2>
                <p className="s-soft mx-auto mt-4 max-w-lg text-base sm:text-lg">
                  Create your account, add your working hours, and let Timely do the arranging.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href="/signup"
                    className="s-btn-primary inline-flex h-12 items-center gap-2 rounded-full px-6 text-base font-semibold"
                  >
                    Register
                    <ArrowRight className="size-4" />
                  </Link>
                  <Link href="/login" className="s-btn-ghost inline-flex h-12 items-center rounded-full px-6 text-base font-semibold">
                    Log in
                  </Link>
                  <a
                    href={REPO_URL}
                    className="s-btn-ghost inline-flex h-12 items-center gap-2 rounded-full px-5 text-base font-semibold"
                  >
                    <Star className="size-4" />
                    Star on GitHub
                  </a>
                </div>
                <Link
                  href="/help"
                  className="s-link mt-6 inline-flex items-center gap-1.5 text-sm font-medium"
                >
                  <LifeBuoy className="size-4" />
                  New here? Read the help center
                </Link>
              </div>
            </Reveal>
          </section>
        </main>

        <SiteFooter />
      </SiteMotion>
    </div>
  );
}
