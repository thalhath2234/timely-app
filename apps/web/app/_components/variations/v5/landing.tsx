import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Download, Key, Lock } from "lucide-react";
import packageJson from "@/package.json";
import { Reveal } from "@/app/_components/landing/reveal";
import { LATEST_RELEASE_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { AI_POINTS, FEATURES, LOOP, PALETTE, PITCH, PLATFORMS, PRIVACY } from "@/app/_components/variations/content";
import { cn } from "@/app/utils/cn";
import { McpDemo, ProposalDemo, SuggestionsDemo } from "./aiCards";
import { Card, Num, RowHead } from "./card";
import { DashboardGraphic, DocsGraphic, HabitsGraphic, ScheduleGraphic, SearchGraphic, ViewsGraphic } from "./featureGraphics";
import HeroBoard from "./heroBoard";
import { SyncDiagram } from "./syncDiagram";

const TITLE = "Timely: your week, at a glance";

export const landingMetadata: Metadata = {
  title: TITLE,
  description: PITCH,
  openGraph: { title: TITLE, description: PITCH, type: "website", siteName: "Timely" },
  twitter: { card: "summary_large_image", title: TITLE, description: PITCH },
};

const HELP = "/5/help";

function Cta({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
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

/** A row of the dashboard: label, rule and count, then a title and the cards. */
function Row({
  id,
  label,
  count,
  title,
  lede,
  children,
}: {
  id: string;
  label: string;
  count: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="v-container scroll-mt-20 py-12 sm:py-16 lg:py-20">
      <Reveal>
        <RowHead label={label} count={count} />
        <div className="mt-5 grid gap-x-10 gap-y-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
          <h2 id={`${id}-title`} className="v5-display max-w-[18ch] text-[2rem] sm:text-[2.5rem] lg:text-[2.75rem]">
            {title}
          </h2>
          {lede ? <p className="max-w-[48ch] text-[0.9375rem] leading-relaxed text-[var(--v-soft)] lg:pb-1">{lede}</p> : null}
        </div>
      </Reveal>
      <div className="mt-7 sm:mt-8">{children}</div>
    </section>
  );
}

function More({ href, children = "Learn more" }: { href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="mt-auto inline-flex w-fit items-center gap-1 pt-3 text-sm font-medium text-[var(--v-primary)] hover:underline">
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

/** The landing page: Timely's dashboard, with the site's content on its cards. */
export default function Landing() {
  const [subscriptions, assistant, suggestions, mcp] = AI_POINTS;
  const graphics = [ScheduleGraphic, DocsGraphic, SearchGraphic, DashboardGraphic, HabitsGraphic, ViewsGraphic];
  const featureLabels = ["Auto-schedule", "Docs and sheets", "Search", "Dashboard", "Habits and goals", "Views"];

  return (
    <>
      {/* Hero: the pitch beside a live dashboard. */}
      <section className="v-container pt-8 pb-14 sm:pt-12 lg:pt-16 lg:pb-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-12">
          <div className="min-w-0">
            <p className="v5-row-head">
              <span>Dashboard</span>
              <span className="v5-badge">Thu 15 Oct</span>
            </p>
            <h1 className="v5-display mt-7 text-[3rem] sm:text-[4rem] lg:text-[5rem] xl:text-[5.5rem]">
              Your week,
              <br />
              at a glance.
            </h1>
            <p className="mt-6 max-w-[44ch] text-[1.0625rem] leading-relaxed text-[var(--v-soft)]">
              Write a thought down and Timely finds the time for it, around your meetings. The assistant runs on the{" "}
              <span className="text-[var(--v-ink)]">Claude or ChatGPT subscription you already pay for</span>, and everything
              stays on your own computer.
            </p>
            <Cta className="mt-8" />
            <a href={LATEST_RELEASE_URL} className="mt-7 inline-flex items-center gap-2 text-xs text-[var(--v-soft)] transition-colors hover:text-[var(--v-ink)]">
              <span className="size-1.5 rounded-full" style={{ background: PALETTE.green }} aria-hidden />
              v{packageJson.version} · Windows, Linux and Android · open source
              <ArrowUpRight className="size-3.5" />
            </a>
          </div>
          <div className="min-w-0">
            <HeroBoard />
          </div>
        </div>
      </section>

      {/* AI */}
      <Row
        id="ai"
        label="AI"
        count={4}
        title="Bring the AI you already pay for."
        lede="Sign in with your Claude or ChatGPT subscription, or any provider's key. The assistant proposes, suggestions fill in the details, and your own agents plug straight in."
      >
        <div className="v5-grid" style={{ "--cols-sm": 1, "--cols-md": 2, "--cols-lg": 3 } as CSSProperties}>
          <Reveal className="v5-span-2 flex">
            <Card title="Subscription" right="No second plan" className="w-full" style={{ borderTopColor: PALETTE.primary }}>
              <div className="grid gap-6 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <div className="flex flex-col">
                  <Num unit="extra plans to pay for">+0</Num>
                  <h3 className="mt-5 text-lg font-semibold tracking-[-0.01em]">{subscriptions.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--v-soft)]">{subscriptions.body}</p>
                  <More href={subscriptions.href}>How sign-in works</More>
                </div>
                <ul className="flex flex-col gap-2 self-center">
                  {[
                    { label: "Claude subscription", note: "sign in through Claude Code", color: PALETTE.primary },
                    { label: "ChatGPT subscription", note: "sign in through Codex", color: PALETTE.teal },
                    { label: "Your own key", note: "any provider, stored encrypted", color: PALETTE.amber, icon: Key },
                  ].map((way) => (
                    <li key={way.label} className="flex items-center gap-3 rounded-lg border border-[var(--v-line-strong)] bg-[var(--v-bg)] px-3 py-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in oklch, ${way.color} 20%, transparent)` }} aria-hidden>
                        {way.icon ? <way.icon className="size-3" style={{ color: way.color }} /> : <span className="size-2 rounded-full" style={{ background: way.color }} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{way.label}</span>
                        <span className="block text-xs text-[var(--v-soft)]">{way.note}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </Reveal>

          <Reveal delay={0.06} className="flex">
            <Card title="Assistant" right="1 change" className="w-full">
              <h3 className="text-base font-semibold tracking-[-0.01em]">{assistant.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--v-soft)]">{assistant.body}</p>
              <More href={assistant.href}>Talk to the assistant</More>
              <div className="mt-auto pt-5">
                <ProposalDemo />
              </div>
            </Card>
          </Reveal>

          <Reveal className="flex">
            <Card title="Smart suggestions" right="4 fields" className="w-full">
              <h3 className="text-base font-semibold tracking-[-0.01em]">{suggestions.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--v-soft)]">{suggestions.body}</p>
              <More href={suggestions.href}>What gets suggested</More>
              <div className="mt-auto pt-5">
                <SuggestionsDemo />
              </div>
            </Card>
          </Reveal>

          <Reveal delay={0.06} className="v5-span-2 flex">
            <Card title="MCP server" right="2 agents" className="w-full">
              <div className="grid gap-6 sm:grid-cols-2 sm:items-center">
                <div className="flex flex-col">
                  <h3 className="text-base font-semibold tracking-[-0.01em]">{mcp.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--v-soft)]">{mcp.body}</p>
                  <More href={mcp.href}>Connect an agent</More>
                </div>
                <McpDemo />
              </div>
            </Card>
          </Reveal>
        </div>
      </Row>

      {/* How it works */}
      <Row id="how-it-works" label="How it works" count={4} title="One loop, from the first thought to done." lede="You decide what matters and how long it takes. Timely does the arranging.">
        <div className="v5-grid" style={{ "--cols-sm": 2, "--cols-md": 2, "--cols-lg": 4 } as CSSProperties}>
          {LOOP.map((step, index) => (
            <Reveal key={step.step} delay={index * 0.05} className="flex">
              <Card title={step.step} right={`${index + 1} of 4`} className="w-full" style={{ borderTop: `3px solid ${step.color}` }}>
                <Num color={step.color}>{String(index + 1).padStart(2, "0")}</Num>
                <h3 className="mt-4 text-base font-semibold tracking-[-0.01em]">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--v-soft)]">{step.body}</p>
                <More href={step.href}>About {step.step}</More>
              </Card>
            </Reveal>
          ))}
        </div>
      </Row>

      {/* Features */}
      <Row id="features" label="Features" count={6} title="Plan, write and keep track in one place." lede="Every card here is a part of the app, and every one links to its help article.">
        <div className="v5-grid" style={{ "--cols-sm": 1, "--cols-md": 2, "--cols-lg": 3 } as CSSProperties}>
          {FEATURES.map((feature, index) => {
            const Graphic = graphics[index];
            return (
              <Reveal key={feature.href} delay={(index % 3) * 0.05} className="flex">
                <Card title={featureLabels[index]} right={<span className="size-2 rounded-full" style={{ background: feature.color }} aria-hidden />} className="w-full">
                  <Graphic />
                  <h3 className="mt-4 text-base font-semibold tracking-[-0.01em]">
                    <Link href={feature.href} className="hover:underline">
                      {feature.title}
                    </Link>
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--v-soft)]">{feature.body}</p>
                  <More href={feature.href}>How it works</More>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </Row>

      {/* Private */}
      <Row id="private" label="Private" count={<Lock className="size-3" aria-label="private" />} title="Runs on your computer. Reaches your phone." lede="The desktop app brings its own server and database. Your phone pairs with it by QR code over your own Tailscale network.">
        <div className="v5-grid" style={{ "--cols-sm": 1, "--cols-md": 2, "--cols-lg": 4 } as CSSProperties}>
          <Reveal className="v5-span-2 v5-row-span-2 flex">
            <Card title="Where your data lives" right="0 clouds" className="w-full" bodyClassName="justify-center">
              <div className="mx-auto w-full max-w-xl py-2">
                <SyncDiagram />
              </div>
            </Card>
          </Reveal>
          {PRIVACY.map((point, index) => (
            <Reveal key={point.title} delay={index * 0.05} className="flex">
              <Card title={["Data", "AI account", "Phone", "Backups"][index]} className="w-full">
                <h3 className="text-base font-semibold tracking-[-0.01em]">{point.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--v-soft)]">{point.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Row>

      {/* Download */}
      <Row id="download" label="Download" count={`v${packageJson.version}`} title="Install it before the end of the day." lede="Every release ships a Windows installer, a Linux AppImage, an AUR package and an Android app. Each one updates itself.">
        <div className="v5-grid" style={{ "--cols-sm": 1, "--cols-md": 2, "--cols-lg": 4 } as CSSProperties}>
          {PLATFORMS.map((platform, index) => (
            <Reveal key={platform.id} delay={index * 0.05} className="flex">
              <Card
                title={platform.name}
                right={
                  <span style={{ color: platform.color }} aria-hidden>
                    <platform.mark className="size-4" />
                  </span>
                }
                className="w-full"
              >
                <p className="truncate font-mono text-xs text-[var(--v-soft)]">{platform.file.replace("x.y.z", packageJson.version)}</p>
                <p className="mt-2 text-sm leading-relaxed">{platform.note}</p>
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-5">
                  <a href={platform.download.href} className="v-btn v-btn-primary !h-10 !px-3.5 !text-sm">
                    <Download className="size-4" />
                    {platform.download.label}
                  </a>
                  <Link href={platform.guide} className="inline-flex h-10 items-center gap-1 text-sm font-medium text-[var(--v-soft)] hover:text-[var(--v-ink)]">
                    Guide
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </Row>

      {/* Closing */}
      <section className="v-container pb-20 sm:pb-24" aria-labelledby="start-title">
        <Reveal>
          <Card title="Start your week" right="Mon 09:00" className="w-full">
            <div className="grid gap-8 py-2 sm:py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-12">
              <div>
                <h2 id="start-title" className="v5-display text-[2.25rem] sm:text-[3rem] lg:text-[3.5rem]">
                  Monday is already planned.
                </h2>
                <p className="mt-4 max-w-[48ch] text-[0.9375rem] leading-relaxed text-[var(--v-soft)]">
                  Register, install the app and capture the first thought. The{" "}
                  <Link href={HELP} className="text-[var(--v-primary)] hover:underline">
                    help center
                  </Link>{" "}
                  walks you through your first week.
                </p>
              </div>
              <div className="flex flex-col gap-3 lg:items-end">
                <Cta />
                <Link href={HELP} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--v-soft)] hover:text-[var(--v-ink)]">
                  Read the help center
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </div>
          </Card>
        </Reveal>
      </section>
    </>
  );
}
