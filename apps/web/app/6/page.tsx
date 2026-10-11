import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { RELEASES_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import pkg from "@/package.json";
import AiDesk from "./_parts/aiDesk";
import Downloads from "./_parts/downloads";
import FeatureNotes from "./_parts/featureNotes";
import DeskFooter from "./_parts/footer";
import { fontVars } from "./_parts/fonts";
import DeskHeader from "./_parts/header";
import HeroDesk from "./_parts/heroDesk";
import LoopDesk from "./_parts/loopDesk";
import { DeskMotion } from "./_parts/motionKit";
import { SectionHead, Tape, noteStyle } from "./_parts/paper";
import Paperwork from "./_parts/paperwork";
import { OpenSourceNote, PrivateGraphic, PrivatePoints } from "./_parts/privateDesk";
import "./_parts/design.css";

export const metadata: Metadata = {
  title: { absolute: "Timely · Design 6" },
  description:
    "Timely is a private planner: capture a thought and it is placed on your week around meetings and inside working hours. The assistant runs on the Claude or ChatGPT plan you already have.",
};

function Section({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={className}>
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">{children}</div>
    </section>
  );
}

/** Design iteration 6: the sticky-note desk. */
export default function DesignSix() {
  return (
    <div className={`d6 ${fontVars}`}>
      <DeskMotion>
        <DeskHeader />
        <main id="main-content">
          {/* Hero */}
          <section aria-labelledby="hero-title" className="relative">
            <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14 lg:pt-14 lg:pb-28">
              <div>
                <p className="d6-faint d6-mono text-[0.8rem]">Private planner · open source · v{pkg.version}</p>
                <h1 id="hero-title" className="d6-display mt-5 text-[2.9rem] leading-[0.98] font-extrabold text-balance sm:text-[4.3rem] lg:text-[4.6rem]">
                  Write it on a{" "}
                  <span className="relative inline-block">
                    <span
                      aria-hidden
                      className="absolute -inset-x-2 -inset-y-0.5 -z-0 rounded-[3px] bg-[var(--n-yellow)] shadow-[0_8px_16px_-8px_rgb(0_0_0/0.8)]"
                      style={{ transform: "rotate(-2.5deg)" }}
                    />
                    <span className="relative text-[var(--paper-ink)]">note.</span>
                  </span>{" "}
                  Timely puts it on your week.
                </h1>
                <p className="d6-soft mt-7 max-w-[34rem] text-[1.15rem] leading-relaxed text-pretty">
                  Timely is a private planner. Capture a thought the moment you have it, and Timely places it on your
                  calendar around your meetings and inside your working hours. The assistant runs on the Claude or
                  ChatGPT plan you already pay for.
                </p>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link href="/signup" className="d6-btn d6-btn-note !min-h-12 !px-6 !text-[1.05rem]">
                    Register
                  </Link>
                  <Link href="/login" className="d6-btn d6-btn-line !min-h-12">
                    Log in
                  </Link>
                  <a href={REPO_URL} className="d6-btn d6-btn-line !min-h-12">
                    <GitHubMark className="size-[18px]" />
                    GitHub
                  </a>
                </div>
                <p className="d6-faint mt-6 text-[0.92rem]">
                  For Windows, Ubuntu, Arch Linux and Android.{" "}
                  <Link href="#download" className="d6-link inline-flex min-h-10 items-center gap-1 text-[var(--soft)]">
                    Downloads
                    <ArrowDown className="size-3.5" />
                  </Link>
                </p>
              </div>
              <HeroDesk />
            </div>
          </section>

          {/* AI */}
          <Section id="ai" className="border-t border-[var(--line)] py-24 sm:py-32">
            <SectionHead
              id="ai-title"
              tab="the assistant"
              color="violet"
              title="An assistant on the subscription you already have"
              lead="Sign in with Claude Code or Codex on your computer and every chat runs on your Claude or ChatGPT plan. It drafts the work; you decide what goes on the desk."
            />
            <AiDesk />
          </Section>

          {/* How it works */}
          <Section id="how-it-works" className="border-t border-[var(--line)] py-24 sm:py-32">
            <SectionHead
              id="how-it-works-title"
              tab="how it works"
              color="yellow"
              title="One note, four stops"
              lead="Every thought goes round the same loop: Capture, Clarify, Auto-schedule, Focus. Follow one of them."
            />
            <LoopDesk />
          </Section>

          {/* Docs and sheets */}
          <Section id="docs-and-sheets" className="border-t border-[var(--line)] py-24 sm:py-32">
            <SectionHead
              id="docs-and-sheets-title"
              tab="docs & sheets"
              color="green"
              title="The paperwork sits next to the plan"
              lead="Write the brief and keep the budget beside the tasks they belong to. Docs and sheets live inside your projects and show up in search."
            />
            <Paperwork />
          </Section>

          {/* Everything else */}
          <Section className="border-t border-[var(--line)] py-24 sm:py-32">
            <SectionHead
              id="more-title"
              tab="also on the desk"
              color="pink"
              title="Everything else you plan with"
            />
            <FeatureNotes />
          </Section>

          {/* Private */}
          <Section id="private" className="border-t border-[var(--line)] py-24 sm:py-32">
            <div className="grid items-center gap-14 lg:grid-cols-2">
              <div>
                <SectionHead id="private-title" tab="private" color="blue" title="It stays in your own drawer" />
                <PrivatePoints />
                <OpenSourceNote href={REPO_URL} version={pkg.version} />
              </div>
              <PrivateGraphic />
            </div>
          </Section>

          {/* Download */}
          <Section id="download" className="border-t border-[var(--line)] py-24 sm:py-32">
            <SectionHead
              id="download-title"
              tab="download"
              color="orange"
              title="Put Timely on your desk"
              lead={
                <>
                  Version {pkg.version}. The desktop apps bring their own server and database; the phone pairs with
                  your computer.{" "}
                  <a href={RELEASES_URL} className="d6-link text-[var(--ink)]">
                    All releases
                  </a>
                </>
              }
            />
            <Downloads />
          </Section>

          {/* Closing */}
          <section aria-labelledby="closing-title" className="border-t border-[var(--line)] py-24 sm:py-32">
            <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
              <div className="d6-note relative mx-auto max-w-3xl px-6 pt-12 pb-10 sm:px-12 sm:pt-14" style={noteStyle("yellow", -1.2)}>
                <Tape className="-top-3 left-10 rotate-[-6deg]" />
                <Tape className="-top-3 right-10 rotate-[5deg]" />
                <h2 id="closing-title" className="d6-display text-[2.5rem] leading-[1] font-extrabold text-balance sm:text-[4rem]">
                  Start with one note.
                </h2>
                <p className="mt-5 max-w-xl text-[1.1rem] leading-relaxed font-medium text-[var(--paper-soft)]">
                  Make an account, write down what is on your mind, and let Timely find it a slot this week.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href="/signup" className="d6-btn d6-btn-ink !min-h-12 !px-6">
                    Register
                  </Link>
                  <Link href="/login" className="d6-btn d6-btn-paper-line !min-h-12">
                    Log in
                  </Link>
                  <a href={REPO_URL} className="d6-btn d6-btn-paper-line !min-h-12">
                    <GitHubMark className="size-[18px]" />
                    GitHub
                  </a>
                </div>
              </div>
            </div>
          </section>
        </main>
        <DeskFooter />
      </DeskMotion>
    </div>
  );
}
