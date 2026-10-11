import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Download, Sparkles } from "lucide-react";
import packageJson from "@/package.json";
import { Reveal } from "@/app/_components/landing/reveal";
import { LATEST_RELEASE_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { AI_POINTS, FEATURES, LOOP, PITCH, PLATFORMS, PRIVACY } from "@/app/_components/variations/content";
import ChatDemo from "./chatDemo";
import { AgentWire, ProposalDemo, SuggestDemo } from "./miniDemos";
import SyncDiagram from "./syncDiagram";
import { cn } from "@/app/utils/cn";
import { Bubble, Timely, Turn, You } from "./turn";

const TITLE = "Timely: say what's on your mind, Timely does the planning";
const DESCRIPTION =
  "A private planner with an AI assistant that runs on the Claude or ChatGPT subscription you already have. Tell it what's on your mind and it proposes the plan, the doc or the sheet; you approve. Open source, for Windows, Linux and Android.";

export const landingMetadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Timely" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const PROVIDERS = [
  { name: "Claude subscription", via: "sign in through Claude Code" },
  { name: "ChatGPT subscription", via: "sign in through Codex" },
  { name: "Your own key", via: "any provider" },
] as const;

/** The loop's four steps, each as something a visitor would say before it. */
const LOOP_ASKS = [
  "I keep forgetting things halfway through a meeting.",
  "Okay, it's in the Inbox. Now what?",
  "When am I supposed to do all of this?",
  "What should I be doing right now?",
] as const;

function Cta() {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Link href="/signup" className="v-btn v-btn-primary">
        Register
        <ArrowRight className="size-4" />
      </Link>
      <Link href="/login" className="v-btn v-btn-ghost">
        Log in
      </Link>
      <a href={REPO_URL} className="v-btn v-btn-ghost">
        <GitHubMark className="size-4" />
        GitHub
      </a>
    </div>
  );
}

function HowItWorksLink({ href, label = "How it works", className }: { href: string; label?: string; className?: string }) {
  return (
    <Link href={href} className={cn("v2-card-link mt-auto pt-3", className)}>
      {label}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

/** The landing page as a conversation: the visitor asks, Timely answers. */
export default function Landing() {
  return (
    <div className="v-container pb-24 sm:pb-32">
      {/* Hero: the opening line and the chat it starts. */}
      <section className="grid gap-10 pt-10 pb-20 sm:pt-16 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:items-center lg:gap-14 lg:pt-20 lg:pb-28">
        <div>
          <Reveal>
            <p className="v2-chip is-soft">
              <Sparkles className="size-3.5 text-[var(--v-primary)]" />
              Timely assistant
              <span className="text-[var(--v-faint)]">·</span>
              open source
            </p>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="v2-h v2-hero-h mt-6 max-w-[14ch]">Say what&rsquo;s on your mind. Timely does the planning.</h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="v2-lead mt-6 max-w-[50ch]">{PITCH}</p>
          </Reveal>
          <Reveal delay={0.15} className="mt-8">
            <Cta />
          </Reveal>
          <Reveal delay={0.2}>
            <a
              href={LATEST_RELEASE_URL}
              className="v-link mt-7 inline-flex min-h-10 items-center gap-2 text-sm"
            >
              <span className="size-1.5 rounded-full bg-[var(--v2-green)]" />
              v{packageJson.version} · Windows, Linux and Android
              <ArrowUpRight className="size-3.5" />
            </a>
          </Reveal>
        </div>
        <Reveal delay={0.12}>
          <ChatDemo />
          <p className="sr-only">
            A chat with the Timely assistant: you ask for a plan, a doc or a sheet, it proposes the changes as cards, and
            you approve them.
          </p>
        </Reveal>
      </section>

      <div className="flex flex-col gap-24 sm:gap-32">
        {/* AI: the subscription point first, then the assistant, suggestions and agents. */}
        <Turn id="ai" you="Which AI is this? Do I have to pay for another subscription?">
          <Bubble tail className="max-w-[46rem]">
            <h2 className="v2-h v2-h2">No. It&rsquo;s the one you already pay for.</h2>
            <p className="v2-lead mt-4">
              Sign in with your Claude or ChatGPT subscription through Claude Code or Codex, or paste any provider&rsquo;s
              key. The assistant proposes, you approve, and your own agents can plug in too.
            </p>
          </Bubble>

          {/* The subscription card spans the row; the other three share the next one. */}
          <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {AI_POINTS.map((point) => {
              const big = point.id === "subscriptions";
              return (
                <article
                  key={point.id}
                  className={
                    big
                      ? "v2-card md:col-span-2 lg:col-span-3 lg:!grid lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:gap-x-10"
                      : "v2-card"
                  }
                  style={{ "--c": point.color } as CSSProperties}
                >
                  <div>
                    <div className="flex items-start gap-2.5">
                      <span className={big ? "v2-dot mt-3" : "v2-dot mt-[9px]"} />
                      <h3 className={big ? "v2-h v2-h3" : "text-lg font-semibold tracking-[-0.01em]"}>{point.title}</h3>
                    </div>
                    <p className={big ? "v2-lead mt-3 max-w-[46ch]" : "mt-2 text-sm leading-relaxed text-[var(--v-soft)]"}>
                      {point.body}
                    </p>
                  </div>

                  {big ? (
                    <ul className="mt-5 flex flex-col gap-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
                      {PROVIDERS.map((provider) => (
                        <li
                          key={provider.name}
                          className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[14px] border border-[var(--v-line)] bg-[var(--v-surface)] px-4 py-2.5"
                        >
                          <span className="size-2 shrink-0 rounded-full bg-[var(--v-primary)]" />
                          <span className="font-semibold">{provider.name}</span>
                          <span className="ml-auto text-sm text-[var(--v-soft)]">{provider.via}</span>
                        </li>
                      ))}
                      <li className="mt-2 text-base font-semibold text-[var(--v-primary)]">No second plan to pay for.</li>
                    </ul>
                  ) : null}
                  {point.id === "assistant" ? <ProposalDemo /> : null}
                  {point.id === "suggestions" ? <SuggestDemo /> : null}
                  {point.id === "mcp" ? <AgentWire /> : null}

                  <HowItWorksLink href={point.href} className={big ? "lg:col-start-1 lg:row-start-2 lg:self-end" : undefined} />
                </article>
              );
            })}
          </div>
        </Turn>

        {/* How it works: the loop as four small conversations. */}
        <Turn id="how-it-works" you="Fine. How does it actually work?">
          <Bubble tail className="max-w-[46rem]">
            <h2 className="v2-h v2-h2">Four steps, every time.</h2>
            <p className="v2-lead mt-4">
              Capture, clarify, schedule, focus. You decide what matters and how long it takes; Timely arranges the week
              around it.
            </p>
          </Bubble>

          <div className="mt-2 grid gap-x-5 gap-y-10 lg:grid-cols-2">
            {LOOP.map((step, index) => (
              <div key={step.step} className="flex flex-col">
                <You>{LOOP_ASKS[index]}</You>
                <Timely className="mt-4">
                  {/* The step colour as a 3px bar down the left edge of the answer. */}
                  <Bubble tail className="flex flex-col border-l-[3px]" style={{ borderColor: step.color }}>
                    <p className="v2-label" style={{ color: step.color }}>
                      {index + 1} · {step.step}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{step.title}</h3>
                    <p className="mt-2 leading-relaxed text-[var(--v-soft)]">{step.body}</p>
                    <HowItWorksLink href={step.href} label="Read more" />
                  </Bubble>
                </Timely>
              </div>
            ))}
          </div>
        </Turn>

        {/* Features: six short answers in two columns. */}
        <Turn id="features" you="What else is in there?">
          <Bubble tail className="max-w-[46rem]">
            <h2 className="v2-h v2-h2">Everything around the plan.</h2>
            <p className="v2-lead mt-4">
              A calendar that tidies itself, docs and sheets beside the work, search, a dashboard, habits, and three views
              of the same tasks.
            </p>
          </Bubble>
          <div className="grid gap-3.5 md:grid-cols-2">
            {FEATURES.map((feature) => (
              <article key={feature.href + feature.title} className="v2-card" style={{ "--c": feature.color } as CSSProperties}>
                <div className="flex items-start gap-2.5">
                  <span className="v2-dot mt-[9px]" />
                  <h3 className="text-lg font-semibold tracking-[-0.01em]">{feature.title}</h3>
                </div>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--v-soft)]">{feature.body}</p>
                <HowItWorksLink href={feature.href} />
              </article>
            ))}
          </div>
        </Turn>

        {/* Private: four short answers and the computer-to-phone diagram. */}
        <Turn id="private" you="And where does all of this live?">
          <Bubble tail className="max-w-[46rem]">
            <h2 className="v2-h v2-h2">On your computer. Nowhere else.</h2>
            <p className="v2-lead mt-4">
              The desktop app brings its own server and database. Your phone pairs with it over your own network, and
              the assistant uses your own AI account.
            </p>
          </Bubble>
          <div className="grid gap-3.5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="grid gap-3.5 sm:grid-cols-2">
              {PRIVACY.map((point) => (
                <article key={point.title} className="v2-card">
                  <h3 className="text-lg font-semibold tracking-[-0.01em]">{point.title}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--v-soft)]">{point.body}</p>
                </article>
              ))}
            </div>
            <div className="v2-card justify-center">
              <SyncDiagram className="mx-auto w-full max-w-[26rem]" />
            </div>
          </div>
        </Turn>

        {/* Download: four platforms in one answer. */}
        <Turn id="download" you="Okay, I'm in. How do I get it?">
          <Bubble tail className="max-w-[46rem]">
            <h2 className="v2-h v2-h2">Pick a platform. It installs in a minute.</h2>
            <p className="v2-lead mt-4">
              Every release ships a Windows installer, a Linux AppImage, an AUR package and an Android app. The latest is
              v{packageJson.version}.
            </p>
          </Bubble>
          <div className="v2-card !p-2 sm:!p-3">
            <ul className="divide-y divide-[var(--v-line)]">
              {PLATFORMS.map((platform) => (
                <li key={platform.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-2 py-4 sm:px-3">
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl"
                    style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 14%, transparent)` }}
                  >
                    <platform.mark className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="font-semibold">{platform.name}</p>
                    <p className="text-sm text-[var(--v-soft)]">{platform.note}</p>
                    <p className="mt-0.5 font-mono text-xs text-[var(--v-faint)]">{platform.file}</p>
                  </div>
                  <div className="flex basis-full gap-2 sm:basis-auto">
                    <a href={platform.download.href} className="v-btn v-btn-primary !h-10 flex-1 justify-center !text-sm sm:flex-none">
                      <Download className="size-4" />
                      {platform.download.label}
                    </a>
                    <Link href={platform.guide} className="v-btn v-btn-ghost !h-10 flex-1 justify-center !text-sm sm:flex-none">
                      <BookOpen className="size-4" />
                      Guide
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Turn>

        {/* Closing: the composer is yours now. */}
        <section className="v2-turn">
          <Reveal>
            <Timely>
              <Bubble tail className="max-w-[46rem]">
                <h2 className="v2-h v2-h2">Your turn.</h2>
                <p className="v2-lead mt-4">
                  Register, install Timely on your computer, sign in with the AI plan you already have, and tell it what
                  is on your mind.
                </p>
              </Bubble>
            </Timely>
          </Reveal>
          <Reveal delay={0.1} className="mt-8 lg:pl-[2.625rem]">
            <div className="v2-big-composer">
              <p className="v2-big-composer-text">What&rsquo;s on your mind?</p>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--v-faint)]">Runs on your own computer, with your own AI account.</p>
                <Link href="/signup" className="v-btn v-btn-primary !rounded-full" aria-label="Register">
                  Register
                  <ArrowUp className="size-4" strokeWidth={2.5} />
                </Link>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:px-2">
              <Link href="/login" className="v-link inline-flex min-h-10 items-center font-medium">
                Log in
              </Link>
              <Link href="/2/help" className="inline-flex min-h-10 items-center gap-1.5 font-medium text-[var(--v-primary)] hover:underline underline-offset-4">
                Read the help center
                <ArrowRight className="size-4" />
              </Link>
              <a href={REPO_URL} className="v-link inline-flex min-h-10 items-center gap-2 font-medium">
                <GitHubMark className="size-4" />
                Source on GitHub
              </a>
            </div>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
