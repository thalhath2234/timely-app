import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, KeyRound, Plug } from "lucide-react";
import packageJson from "@/package.json";
import { Reveal } from "@/app/_components/landing/reveal";
import { CLAUDE_CODE_URL, CODEX_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { AI_POINTS, FEATURES, LOOP, PALETTE, PITCH, PLATFORMS, PRIVACY } from "@/app/_components/variations/content";
import { cn } from "@/app/utils/cn";
import AiDemo from "./aiDemo";
import { ColumnHead, SectionColumn } from "./column";
import { FEATURE_GLYPHS } from "./featureGlyphs";
import HeroBoard from "./heroBoard";
import SyncDiagram from "./syncDiagram";

const TITLE = "Timely: from Inbox to Done, no shuffling in between";
const DESCRIPTION =
  "A private planner with an AI assistant that runs on the Claude or ChatGPT subscription you already have. Capture a thought and Timely places it on your week, with smart suggestions, docs, sheets and an MCP server for your own agents. Open source, for Windows, Linux and Android.";

export const landingMetadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Timely" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const PROVIDERS = [
  { name: "Claude subscription", note: "Sign in through Claude Code", href: CLAUDE_CODE_URL },
  { name: "ChatGPT subscription", note: "Sign in through Codex", href: CODEX_URL },
  { name: "Your own key", note: "Any provider, stored encrypted", href: "/help/assistant/subscriptions" },
] as const;

/** Design 3: the landing page as a board, from the Inbox column to Done. */
export default function Landing() {
  return (
    <>
      <Hero />
      <AiColumn />
      <HowItWorksColumn />
      <FeaturesColumn />
      <PrivateColumn />
      <DownloadColumn />
      <DoneCard />
    </>
  );
}

function Hero() {
  return (
    <section className="pt-8 pb-10 sm:pt-12 lg:pt-16 lg:pb-14">
      <div className="v-container">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--v-faint)]">
          <span aria-hidden className="v3-dot" style={{ "--c": "var(--v-primary)" } as CSSProperties} />
          <span className="v3-mono">Board · this week</span>
          <span className="v3-mono">v{packageJson.version}</span>
        </div>
        <h1 className="v3-display mt-4 max-w-[12ch] text-[3rem] sm:text-[4.5rem] lg:max-w-none lg:text-[6.25rem]">
          From Inbox to Done.{" "}
          <br className="hidden lg:block" />
          No shuffling in between.
        </h1>
        <div className="mt-7 flex flex-col gap-6 lg:mt-9 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <p className="max-w-xl text-base leading-relaxed text-[var(--v-soft)] sm:text-lg">{PITCH}</p>
          <div className="flex flex-wrap gap-2.5 lg:flex-none">
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
        </div>
      </div>
      <div className="v-container mt-10 lg:mt-14">
        <HeroBoard />
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--v-faint)]">
          <span className="v3-mono">Clarified → length and project</span>
          <span className="v3-mono">Scheduled → day and time</span>
          <span className="v3-mono">Done → ticked</span>
        </p>
      </div>
    </section>
  );
}

/* ---- #ai ---- */

function AiColumn() {
  const [subscriptions, assistant, suggestions, mcp] = AI_POINTS;
  return (
    <SectionColumn
      id="ai"
      color={PALETTE.primary}
      label="AI"
      count={AI_POINTS.length}
      title="The assistant you already pay for."
      intro="Every change arrives as a card you approve. The plan it runs on is the one you already have."
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <Reveal className="v3-card p-5 sm:p-6 lg:col-span-2" as="div">
          <ColumnHead color={subscriptions.color} label="Subscriptions" className="!border-t-0 !pt-0" />
          <h3 className="v3-display mt-3 text-[1.75rem] sm:text-[2.1rem]">{subscriptions.title}</h3>
          <p className="mt-3 max-w-lg text-[0.95rem] leading-relaxed text-[var(--v-soft)]">{subscriptions.body}</p>
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            {PROVIDERS.map((provider, index) => (
              <a key={provider.name} href={provider.href} className="v3-card v3-card-link v3-card-raised gap-3 p-4">
                <span className="flex items-center justify-between">
                  <span className="v3-mono text-[var(--v-faint)]">0{index + 1}</span>
                  {index === 2 ? <KeyRound className="size-4 text-[var(--v-primary)]" /> : <Check className="size-4 text-[var(--v-primary)]" strokeWidth={2.5} />}
                </span>
                <span>
                  <span className="block text-[0.95rem] font-semibold">{provider.name}</span>
                  <span className="mt-0.5 block text-sm text-[var(--v-soft)]">{provider.note}</span>
                </span>
              </a>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="v3-chip v3-chip-ai">No second plan to pay for</span>
            <CardLink href={subscriptions.href} />
          </div>
        </Reveal>

        <Reveal delay={0.08} className="v3-card p-5 sm:p-6 lg:row-span-2">
          <ColumnHead color={assistant.color} label="Assistant" className="!border-t-0 !pt-0" />
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.01em]">{assistant.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--v-soft)]">{assistant.body}</p>
          <div className="mt-5 flex-1">
            <AiDemo />
          </div>
          <CardLink href={assistant.href} className="mt-5" />
        </Reveal>

        <Reveal delay={0.12} className="v3-card p-5 sm:p-6">
          <ColumnHead color={suggestions.color} label="Suggestions" className="!border-t-0 !pt-0" />
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.01em]">{suggestions.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--v-soft)]">{suggestions.body}</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {["2h", "Work", "Fri", "Launch", "Brief template"].map((chip) => (
              <span key={chip} className="v3-chip v3-chip-ai">
                {chip}
              </span>
            ))}
          </div>
          <CardLink href={suggestions.href} className="mt-5" />
        </Reveal>

        <Reveal delay={0.16} className="v3-card p-5 sm:p-6">
          <ColumnHead color={mcp.color} label="MCP" className="!border-t-0 !pt-0" />
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.01em]">{mcp.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--v-soft)]">{mcp.body}</p>
          <div className="mt-4 flex items-center gap-2 text-[var(--v-soft)]">
            <span className="v3-chip">Claude Code</span>
            <span className="v3-chip">Codex</span>
            <ArrowRight className="size-3.5 text-[var(--v-faint)]" />
            <span className="v3-chip v3-chip-ai">
              <Plug className="size-3" />
              Timely
            </span>
          </div>
          <CardLink href={mcp.href} className="mt-5" />
        </Reveal>
      </div>
    </SectionColumn>
  );
}

/* ---- #how-it-works ---- */

function HowItWorksColumn() {
  return (
    <SectionColumn
      id="how-it-works"
      color={PALETTE.green}
      label="How it works"
      count={LOOP.length}
      title="Four stages. One loop."
      intro="Every task crosses the same board. You write; the assistant and Auto-schedule move the cards."
    >
      <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {LOOP.map((step, index) => (
          <Reveal key={step.step} as="li" delay={index * 0.06} className="v3-card">
            {/* Number beside the text on phones, above it from md up. */}
            <Link
              href={step.href}
              className="v3-card-link flex h-full gap-4 rounded-[var(--v-radius)] p-5 md:flex-col"
              style={{ "--c": step.color } as CSSProperties}
            >
              <span className="flex w-14 flex-none flex-col items-start gap-2 md:w-auto md:flex-row md:items-center md:justify-between">
                <span className="v3-num">0{index + 1}</span>
                <span className="v3-count">{step.step}</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col md:mt-4">
                <span className="block text-xl font-semibold tracking-[-0.01em]">{step.title}</span>
                <span className="mt-2 block flex-1 text-sm leading-relaxed text-[var(--v-soft)]">{step.body}</span>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[var(--v-primary)] md:mt-5">
                  How it works
                  <ArrowRight className="size-3.5" />
                </span>
              </span>
            </Link>
          </Reveal>
        ))}
      </ol>
    </SectionColumn>
  );
}

/* ---- #features ---- */

function FeaturesColumn() {
  return (
    <SectionColumn
      id="features"
      color={PALETTE.violet}
      label="Features"
      count={FEATURES.length}
      title="Everything else, on the same board."
      intro="The calendar, docs and sheets, search, the dashboard, habits and three views of your tasks."
    >
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, index) => {
          const Glyph = FEATURE_GLYPHS[index];
          return (
            <Reveal key={feature.href} as="li" delay={(index % 3) * 0.06} className="v3-card">
              <Link href={feature.href} className="v3-card-link flex h-full flex-col rounded-[var(--v-radius)] p-5">
                <span className="block rounded-[4px] border border-[var(--v-line)] bg-[var(--v-bg)] px-3 py-2">
                  <Glyph color={feature.color} />
                </span>
                <span className="mt-5 flex items-start gap-2.5">
                  <span aria-hidden className="mt-[7px] size-2 flex-none rounded-full" style={{ background: feature.color }} />
                  <span className="text-lg font-semibold tracking-[-0.01em]">{feature.title}</span>
                </span>
                <span className="mt-2 block flex-1 pl-[1.125rem] text-sm leading-relaxed text-[var(--v-soft)]">{feature.body}</span>
                <span className="mt-4 inline-flex items-center gap-1 pl-[1.125rem] text-sm font-medium text-[var(--v-primary)]">
                  How it works
                  <ArrowRight className="size-3.5" />
                </span>
              </Link>
            </Reveal>
          );
        })}
      </ul>
    </SectionColumn>
  );
}

/* ---- #private ---- */

function PrivateColumn() {
  return (
    <SectionColumn
      id="private"
      color={PALETTE.blue}
      label="Private"
      count={PRIVACY.length + 1}
      title="Runs on your computer. Stays there."
      intro="The desktop app brings its own server and database. Your phone pairs to it, not to a cloud."
    >
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Reveal className="v3-card p-5 sm:p-6 md:col-span-2 lg:col-span-1 lg:row-span-2">
          <ColumnHead color={PALETTE.green} label="Computer ⇄ phone" className="!border-t-0 !pt-0" />
          <div className="mt-4 flex flex-1 items-center">
            <SyncDiagram />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--v-soft)]">
            Pair by QR code once. After that the phone talks to your computer over your own Tailscale network.
          </p>
        </Reveal>
        {PRIVACY.map((point, index) => (
          <Reveal key={point.title} delay={0.06 + index * 0.05} className="v3-card p-5 sm:p-6">
            <span className="v3-mono text-[var(--v-faint)]">0{index + 1}</span>
            <h3 className="mt-3 text-lg font-semibold tracking-[-0.01em]">{point.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--v-soft)]">{point.body}</p>
          </Reveal>
        ))}
      </div>
    </SectionColumn>
  );
}

/* ---- #download ---- */

function DownloadColumn() {
  return (
    <SectionColumn
      id="download"
      color={PALETTE.teal}
      label="Download"
      count={PLATFORMS.length}
      title="Pick a platform."
      intro="Windows, Ubuntu, Arch Linux and Android. Each with a guide that takes you from install to a planned week."
      trailing={<span className="v3-mono text-[var(--v-faint)]">v{packageJson.version}</span>}
    >
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLATFORMS.map((platform, index) => (
          <Reveal key={platform.id} as="li" delay={index * 0.06} className="v3-card p-5">
            <div className="flex items-center gap-3">
              <span
                className="flex size-10 flex-none items-center justify-center rounded-[var(--v-radius)] border border-[var(--v-line)]"
                style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 12%, transparent)` }}
              >
                <platform.mark className="size-5" />
              </span>
              <span className="text-lg font-semibold tracking-[-0.01em]">{platform.name}</span>
            </div>
            <p className="v3-mono mt-4 truncate !normal-case !tracking-normal text-[var(--v-faint)]">
              {platform.file.replace("x.y.z", packageJson.version)}
            </p>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--v-soft)]">{platform.note}</p>
            <div className="mt-5 flex flex-col gap-2">
              <a href={platform.download.href} className="v-btn v-btn-primary !h-10 justify-center !text-sm">
                {platform.download.label}
              </a>
              <Link href={platform.guide} className="v-btn v-btn-ghost !h-10 justify-center !text-sm">
                Install guide
                <ArrowUpRight className="size-4" />
              </Link>
            </div>
          </Reveal>
        ))}
      </ul>
    </SectionColumn>
  );
}

/* ---- Closing: the Done card ---- */

function DoneCard() {
  return (
    <section aria-labelledby="done-title" className="v3-section !pt-0 pb-16 lg:pb-24">
      <div className="v-container">
        <Reveal className="v3-card p-6 sm:p-8 lg:p-10">
          <ColumnHead color={PALETTE.amber} label="Done" count={1} className="!border-t-0 !pt-0" />
          <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <span className="flex size-10 items-center justify-center rounded-[var(--v-radius)] bg-[var(--v3-done)] text-[#1a1200]">
                <Check className="size-5" strokeWidth={3} />
              </span>
              <h2 id="done-title" className="v3-display mt-5 text-[2.4rem] sm:text-[3.2rem] lg:text-[4rem]">
                Done reading. Start your week.
              </h2>
              <p className="mt-4 max-w-lg text-base leading-relaxed text-[var(--v-soft)]">
                Register, install it on your computer, and write down the first thing on your mind.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/signup" className="v-btn v-btn-primary">
                Register
                <ArrowRight className="size-4" />
              </Link>
              <Link href="/login" className="v-btn v-btn-ghost">
                Log in
              </Link>
              <Link href="/3/help" className="v-btn v-btn-ghost">
                Help center
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function CardLink({ href, className }: { href: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-1 self-start text-sm font-medium text-[var(--v-primary)] hover:underline", className)}>
      How it works
      <ArrowRight className="size-3.5" />
    </Link>
  );
}
