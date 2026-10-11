import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import packageJson from "@/package.json";
import { Reveal } from "@/app/_components/landing/reveal";
import { REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { AI_POINTS, FEATURES, LOOP, PITCH, PLATFORMS, PRIVACY } from "@/app/_components/variations/content";
import BudgetSheet from "./budgetSheet";
import { FormulaBar, HeroLoopProvider, HeroWeekPanel } from "./hero";
import { RangeHeader, SheetFrame, TableHead } from "./sheetChrome";
import SyncChart from "./syncChart";

const TITLE = "Timely: your week, computed";
const DESCRIPTION =
  "A private planner with an AI assistant that runs on the Claude or ChatGPT subscription you already have. Capture a thought and Timely places it on your week, with smart suggestions, docs, sheets and an MCP server for your own agents. Open source, for Windows, Linux and Android.";

export const landingMetadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Timely" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** What each step of the loop leaves behind, as a cell value. */
const LOOP_RESULTS = ["Inbox · 1 new", "Work · 2h · Website", "Thu 10:00–12:00", "Done ✓"];

const WAYS_IN = [
  { label: "Claude subscription", via: "sign in through Claude Code" },
  { label: "ChatGPT subscription", via: "sign in through Codex" },
  { label: "Any provider key", via: "paste it, stored encrypted" },
];

function Cta({ className }: { className?: string }) {
  return (
    <div className={className}>
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

function Section({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`v4-section scroll-mt-36 pt-[44px] pb-[66px] lg:pb-[88px] ${className ?? ""}`}>
      {children}
    </section>
  );
}

/** Design 4: the landing page as a Timely sheet. The week is computed in the formula bar. */
export default function Landing() {
  return (
    <HeroLoopProvider>
      <FormulaBar />
      <SheetFrame letters={LETTERS}>
        {/* Hero: a merged range for the headline, the week panel beside it. */}
        <section className="v4-section pt-[44px] pb-[22px] lg:pt-[66px] lg:pb-[44px]">
          <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start">
            <div>
              <div className="v4-range" aria-hidden>
                <span className="v4-range-name">A1:E3</span>
                <span className="v4-range-addr">merged · v{packageJson.version}</span>
              </div>
              <h1 className="v4-display v4-selected mt-2 -ml-3 px-3 py-3 text-[3rem] leading-[0.95] sm:text-[4.5rem] lg:text-[5.75rem] lg:-ml-4 lg:px-4">
                Your week, computed.
              </h1>
              <p className="mt-7 max-w-[52ch] text-base leading-relaxed text-[var(--v-soft)] sm:text-lg">{PITCH}</p>
              <Cta className="mt-8 flex flex-wrap items-center gap-2.5" />
              <p className="v4-mono mt-6 text-xs text-[var(--v-faint)]">
                <span className="text-[var(--v-primary)]">=</span> Type a thought in the formula bar above. Timely fills the week.
              </p>
            </div>
            <Reveal delay={0.1} className="lg:pt-[44px]">
              <HeroWeekPanel />
            </Reveal>
          </div>
        </section>

        {/* AI: a live sheet the assistant fills, and the four points as cells. */}
        <Section id="ai">
          <Reveal>
            <RangeHeader
              name="ai"
              range="A9:H22"
              title="An assistant on your own subscription."
              lede="Sign in with your Claude or ChatGPT subscription, or pick any model with your own key. The assistant proposes, smart suggestions fill in the blanks, and your own agents plug straight in."
            />
          </Reveal>
          <div className="mt-8 grid gap-6 lg:mt-11 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-8">
            <Reveal delay={0.05}>
              <BudgetSheet />
            </Reveal>
            <Reveal delay={0.1}>
              <div className="v4-table grid sm:grid-cols-2 sm:grid-rows-[auto_auto_auto]">
                {AI_POINTS.map((point, index) => {
                  const big = point.id === "subscriptions";
                  const wide = point.id === "mcp";
                  return (
                    <Link
                      key={point.id}
                      href={point.href}
                      className={`group flex flex-col gap-2 border-b border-[var(--v-line)] p-4 transition-colors last:border-b-0 hover:bg-[color-mix(in_oklch,var(--v-primary)_7%,var(--v-surface))] sm:p-5 ${
                        big ? "sm:row-span-2 sm:border-r" : wide ? "sm:col-span-2" : ""
                      } ${index === 1 ? "sm:border-b" : ""}`}
                      style={{ "--c": point.color } as CSSProperties}
                    >
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-[1px]" style={{ background: point.color }} />
                        <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)]">{point.id}</span>
                      </span>
                      <span className={`v4-display leading-tight ${big ? "text-[1.5rem] sm:text-[1.75rem]" : "text-lg"}`}>{point.title}</span>
                      <span className="text-sm leading-relaxed text-[var(--v-soft)]">{point.body}</span>
                      {big ? (
                        <span className="mt-2 border border-[var(--v-line-strong)]">
                          {WAYS_IN.map((way, i) => (
                            <span key={way.label} className="flex items-baseline gap-3 border-b border-[var(--v-line)] px-3 py-2 text-sm last:border-b-0">
                              <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)]">{i + 1}</span>
                              <span className="flex min-w-0 flex-col">
                                <span className="font-medium">{way.label}</span>
                                <span className="text-xs text-[var(--v-soft)]">{way.via}</span>
                              </span>
                            </span>
                          ))}
                          <span className="block border-t border-[var(--v-line-strong)] bg-[var(--v-raised)] px-3 py-2 text-xs text-[var(--v-soft)]">
                            <span className="v4-mono text-[var(--v-primary)]">=</span> No second plan to pay for.
                          </span>
                        </span>
                      ) : null}
                      <span className="mt-auto pt-1 text-sm font-medium text-[var(--v-primary)] group-hover:underline">Read how →</span>
                    </Link>
                  );
                })}
              </div>
            </Reveal>
          </div>
        </Section>

        {/* How it works: the loop as a four-row table. */}
        <Section id="how-it-works">
          <Reveal>
            <RangeHeader
              name="how_it_works"
              range="A24:H31"
              title="One loop, four rows."
              lede="You decide what matters and how long it takes. Timely does the arranging."
            />
          </Reveal>
          <Reveal delay={0.05} className="mt-8 lg:mt-11">
            <div className="v4-table">
              <TableHead
                cols="8rem minmax(0,1fr) minmax(0,1.5fr) 11rem"
                className="max-md:!hidden"
                columns={[
                  { letter: "A", label: "Step" },
                  { letter: "B", label: "What you do" },
                  { letter: "C", label: "What Timely does" },
                  { letter: "D", label: "Result" },
                ]}
              />
              {LOOP.map((step, index) => (
                <Link
                  key={step.step}
                  href={step.href}
                  className="v4-tr v4-stack"
                  style={{ "--cols": "8rem minmax(0,1fr) minmax(0,1.5fr) 11rem", "--c": step.color } as CSSProperties}
                >
                  <span className="v4-td v4-fill font-semibold md:self-stretch">
                    <span className="v4-mono text-[0.6875rem] text-[var(--v-soft)]">{index + 1}</span>
                    {step.step}
                  </span>
                  <span className="v4-td text-[0.9375rem] font-medium max-md:mt-1">{step.title}</span>
                  <span className="v4-td text-sm leading-relaxed text-[var(--v-soft)]">{step.body}</span>
                  <span className="v4-td v4-td-mono max-md:mt-1">
                    <span className="md:hidden">→ </span>
                    <span className="md:text-[var(--v-primary)]">{LOOP_RESULTS[index]}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Reveal>
        </Section>

        {/* Features: six rows, each linking to its article. */}
        <Section id="features">
          <Reveal>
            <RangeHeader name="features" range="A33:H42" title="Everything else, one row each." />
          </Reveal>
          <Reveal delay={0.05} className="mt-8 lg:mt-11">
            <div className="v4-table">
              <TableHead
                cols="3.5rem minmax(0,1fr) minmax(0,1.7fr) 9rem"
                className="max-md:!hidden"
                columns={[
                  { letter: "A", label: "" },
                  { letter: "B", label: "Feature" },
                  { letter: "C", label: "What it does" },
                  { letter: "D", label: "Guide" },
                ]}
              />
              {FEATURES.map((feature) => (
                <Link
                  key={feature.href + feature.title}
                  href={feature.href}
                  className="v4-tr v4-stack"
                  style={{ "--cols": "3.5rem minmax(0,1fr) minmax(0,1.7fr) 9rem", "--c": feature.color } as CSSProperties}
                >
                  <span className="v4-td v4-fill v4-stack-hide md:self-stretch" />
                  <span className="v4-td text-[0.9375rem] font-medium">
                    <span className="size-2 shrink-0 rounded-[1px] md:hidden" style={{ background: feature.color }} />
                    {feature.title}
                  </span>
                  <span className="v4-td text-sm leading-relaxed text-[var(--v-soft)]">{feature.body}</span>
                  <span className="v4-td text-sm font-medium text-[var(--v-primary)] max-md:mt-1">How it works →</span>
                </Link>
              ))}
            </div>
          </Reveal>
        </Section>

        {/* Private: four rows and a chart cell. */}
        <Section id="private">
          <Reveal>
            <RangeHeader
              name="private"
              range="A44:H51"
              title="Runs on your computer. Reaches your phone."
              lede="The desktop app brings its own server and database. Your phone pairs with it by QR code over your own Tailscale network."
            />
          </Reveal>
          <div className="mt-8 grid gap-6 lg:mt-11 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-8">
            <Reveal delay={0.05}>
              <div className="v4-table">
                <TableHead
                  cols="minmax(0,0.9fr) minmax(0,1.7fr)"
                  className="max-md:!hidden"
                  columns={[
                    { letter: "A", label: "Promise" },
                    { letter: "B", label: "How" },
                  ]}
                />
                {PRIVACY.map((point) => (
                  <div key={point.title} className="v4-tr v4-stack" style={{ "--cols": "minmax(0,0.9fr) minmax(0,1.7fr)" } as CSSProperties}>
                    <span className="v4-td text-[0.9375rem] font-medium">{point.title}</span>
                    <span className="v4-td text-sm leading-relaxed text-[var(--v-soft)]">{point.body}</span>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="v4-cell flex h-full flex-col">
                <div className="flex h-[var(--v4-row)] shrink-0 items-center justify-between border-b border-[var(--v-line-strong)] px-3.5">
                  <span className="v4-mono text-xs text-[var(--v-soft)]">chart · computer ⇄ phone</span>
                  <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)]">C45:D50</span>
                </div>
                <div className="flex flex-1 items-center px-2 py-3 sm:px-4">
                  <SyncChart className="mx-auto max-w-[520px]" />
                </div>
              </div>
            </Reveal>
          </div>
        </Section>

        {/* Download: one row per platform. */}
        <Section id="download">
          <Reveal>
            <RangeHeader
              name="download"
              range="A53:H59"
              title="Install it in a row."
              lede={
                <>
                  Every release ships a Windows installer, a Linux AppImage, an AUR package and an Android app. Current version:{" "}
                  <span className="v4-mono text-[var(--v-ink)]">v{packageJson.version}</span>.
                </>
              }
            />
          </Reveal>
          <Reveal delay={0.05} className="mt-8 lg:mt-11">
            <div className="v4-table">
              <TableHead
                cols="11rem minmax(0,1fr) 12rem 8rem"
                className="max-md:!hidden"
                columns={[
                  { letter: "A", label: "Platform" },
                  { letter: "B", label: "File" },
                  { letter: "C", label: "Download" },
                  { letter: "D", label: "Guide" },
                ]}
              />
              {PLATFORMS.map((platform) => (
                <div
                  key={platform.id}
                  className="v4-tr v4-stack"
                  style={{ "--cols": "11rem minmax(0,1fr) 12rem 8rem", "--c": platform.color } as CSSProperties}
                >
                  <span className="v4-td v4-fill font-semibold md:self-stretch">
                    <span className="shrink-0" style={{ color: platform.color }}>
                      <platform.mark className="size-4" />
                    </span>
                    {platform.name}
                  </span>
                  <span className="v4-td flex-col !items-start gap-0.5">
                    <span className="v4-mono text-xs text-[var(--v-ink)]">{platform.file}</span>
                    <span className="text-xs text-[var(--v-soft)]">{platform.note}</span>
                  </span>
                  <span className="v4-td max-md:mt-2 max-md:flex-row max-md:gap-2">
                    <a href={platform.download.href} className="v4-cellbtn v4-cellbtn-primary">
                      {platform.download.label}
                      <ArrowUpRight className="size-3.5" />
                    </a>
                    <Link href={platform.guide} className="v4-cellbtn v4-cellbtn-ghost md:!hidden">
                      Guide
                    </Link>
                  </span>
                  <span className="v4-td v4-stack-hide">
                    <Link href={platform.guide} className="text-sm font-medium text-[var(--v-primary)] hover:underline">
                      Guide →
                    </Link>
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </Section>

        {/* Closing: the selected cell is the call to action. */}
        <Section className="pb-[88px] lg:pb-[132px]">
          <Reveal>
            <RangeHeader name="start" range="A61:H63" title="Your first week is one formula away." />
          </Reveal>
          <Reveal delay={0.05} className="mt-8 lg:mt-11">
            <div className="v4-table grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Link
                href="/signup"
                className="v4-selected flex min-h-[88px] flex-col justify-center gap-1 bg-[color-mix(in_srgb,var(--v-primary)_14%,var(--v-surface))] px-5 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--v-primary)_22%,var(--v-surface))]"
              >
                <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)]">A62 · free, open source</span>
                <span className="v4-mono text-xl font-semibold text-[var(--v-primary)] sm:text-2xl">=REGISTER()</span>
              </Link>
              <Link
                href="/login"
                className="flex min-h-[88px] flex-col justify-center gap-1 border-t border-[var(--v-line)] px-5 py-4 transition-colors hover:bg-[var(--v-raised)] sm:border-t-0 sm:border-l"
              >
                <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)]">B62 · already set up?</span>
                <span className="v4-mono text-lg font-medium">=LOGIN()</span>
              </Link>
              <Link
                href="/4/help"
                className="flex min-h-[88px] flex-col justify-center gap-1 border-t border-[var(--v-line)] px-5 py-4 transition-colors hover:bg-[var(--v-raised)] sm:border-t-0 sm:border-l"
              >
                <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)]">C62 · every answer</span>
                <span className="v4-mono text-lg font-medium">=HELP()</span>
              </Link>
            </div>
            <p className="v4-mono mt-5 text-xs text-[var(--v-faint)]">
              Timely v{packageJson.version} · Windows, Linux, Android · MIT ·{" "}
              <a href={REPO_URL} className="text-[var(--v-soft)] hover:text-[var(--v-ink)]">
                source on GitHub
              </a>
            </p>
          </Reveal>
        </Section>
      </SheetFrame>
    </HeroLoopProvider>
  );
}
