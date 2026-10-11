import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import { ISSUES_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import pkg from "@/package.json";
import DeskSearch from "../_parts/deskSearch";
import { PLATFORMS } from "../_parts/downloads";
import { fontVars } from "../_parts/fonts";
import DeskFooter from "../_parts/footer";
import DeskHeader from "../_parts/header";
import { DroppedNote, FolderBoard } from "../_parts/helpBoard";
import { DeskMotion } from "../_parts/motionKit";
import { Tape, noteStyle, type NoteColor } from "../_parts/paper";
import "../_parts/design.css";

export const metadata: Metadata = {
  title: { absolute: "Timely Help Center · Design 6" },
  description: "Install Timely, plan your first week, and learn the assistant, docs, sheets and everything else.",
};

const POPULAR: { label: string; href: string; color: NoteColor }[] = [
  { label: "Use your Claude or ChatGPT plan", href: "/help/assistant/subscriptions", color: "pink" },
  { label: "Auto-schedule", href: "/help/plan/auto-schedule", color: "green" },
  { label: "Pair your phone", href: "/help/install/android#pair", color: "blue" },
  { label: "Keyboard shortcuts", href: "/help/start/shortcuts", color: "yellow" },
  { label: "Connect an agent", href: "/help/assistant/mcp", color: "violet" },
  { label: "Back up and restore", href: "/help/account/backups", color: "orange" },
];

const PLATFORM_DETAIL: Record<string, string> = {
  Windows: "Installer for Windows 10 and 11",
  Ubuntu: "AppImage, needs libfuse2",
  "Arch Linux": "timely-bin from the AUR",
  Android: "APK that pairs by QR code",
};

const FOLDERS = HELP_SECTIONS.map((section) => ({
  id: section.id,
  title: section.title,
  description: section.description,
  articles: section.articles.map((article) => ({
    title: article.title,
    summary: article.summary,
    href: articleHref(section, article),
  })),
}));

const ICONS = Object.fromEntries(
  HELP_SECTIONS.map((section) => [section.id, <section.icon key={section.id} aria-hidden className="size-4 shrink-0" strokeWidth={2.4} />]),
);

const ARTICLE_COUNT = FOLDERS.reduce((sum, folder) => sum + folder.articles.length, 0);

/** Design iteration 6: the help center home as a desk with a search card and a board of folders. */
export default function DesignSixHelp() {
  return (
    <div className={`d6 ${fontVars}`}>
      <DeskMotion>
        <DeskHeader current="help" />
        <main id="main-content">
          {/* Search */}
          <section aria-labelledby="help-title">
            <div className="mx-auto grid max-w-[1240px] items-start gap-12 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:pt-16">
              <div>
                <p className="d6-mono d6-faint text-[0.8rem]">
                  Help center · {ARTICLE_COUNT} articles in {FOLDERS.length} folders · v{pkg.version}
                </p>
                <h1 id="help-title" className="d6-display mt-4 text-[2.7rem] leading-[1] font-extrabold text-balance sm:text-[4.2rem]">
                  What can we help you{" "}
                  <span className="relative inline-block">
                    <span aria-hidden className="absolute -inset-x-2 -inset-y-0.5 rounded-[3px] bg-[var(--n-green)]" style={{ transform: "rotate(-2deg)" }} />
                    <span className="relative text-[var(--paper-ink)]">sort out?</span>
                  </span>
                </h1>
                <p className="d6-soft mt-5 max-w-xl text-[1.1rem] leading-relaxed">
                  Install Timely, plan your first week, and learn the assistant, docs, sheets and the rest. Press{" "}
                  <kbd className="d6-kbd">/</kbd> to search from anywhere on this page.
                </p>
                <div className="relative z-20 mt-8 max-w-2xl">
                  <DeskSearch entries={SEARCH_INDEX} />
                </div>
                <div className="mt-8">
                  <h2 className="d6-display text-[0.95rem] font-bold text-[var(--soft)]">People often look for</h2>
                  <ul className="mt-3 flex flex-wrap gap-2.5">
                    {POPULAR.map((item, index) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="d6-note d6-tilt flex min-h-10 items-center px-3.5 text-[0.92rem] font-bold"
                          style={noteStyle(item.color, 0, { ["--tilt" as string]: `${[-1.5, 1, -0.5, 1.5, -1, 0.8][index]}deg` })}
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Start here */}
              <div className="relative lg:pt-10">
                <DroppedNote color="yellow" rotate={2} delay={0.1} tape className="px-6 pt-8 pb-6">
                  <p className="d6-hand text-[1.6rem] leading-tight font-bold">New here? Start with these two.</p>
                  <ul className="mt-4 space-y-2">
                    {[
                      { label: "What is Timely?", href: "/help/start/what-is-timely" },
                      { label: "Set up your first week", href: "/help/start/first-week" },
                    ].map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="group flex min-h-12 items-center justify-between gap-2 rounded-md bg-[var(--paper-ink)] px-4 font-bold text-[var(--n-cream)] transition-colors hover:bg-black"
                        >
                          {link.label}
                          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-[0.9rem] font-medium text-[var(--paper-soft)]">
                    Capture, clarify, Auto-schedule, focus: the loop the rest of the help builds on.
                  </p>
                </DroppedNote>
                <DroppedNote color="pink" rotate={-3} delay={0.35} className="mt-6 ml-6 w-fit max-w-[260px] px-4 py-3 sm:ml-14">
                  <p className="d6-hand text-[1.15rem] leading-tight font-bold">Using the AI? Read “Use your Claude or ChatGPT subscription”.</p>
                </DroppedNote>
              </div>
            </div>
          </section>

          {/* Install */}
          <section aria-labelledby="install-title" className="border-t border-[var(--line)] py-16 sm:py-20">
            <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <h2 id="install-title" className="d6-display text-[2rem] leading-tight font-extrabold sm:text-[2.6rem]">
                  Install on your machine
                </h2>
                <Link href="/6#download" className="d6-link flex min-h-10 items-center gap-1 text-[var(--soft)]">
                  Downloads
                  <ArrowRight className="size-4" />
                </Link>
              </div>
              <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {PLATFORMS.map((platform) => (
                  <li key={platform.name}>
                    <Link
                      href={platform.guide}
                      className="d6-note d6-tilt group flex h-full min-h-[150px] flex-col p-5"
                      style={noteStyle(platform.color, 0, { ["--tilt" as string]: `${platform.rotate}deg` })}
                    >
                      <platform.mark className="size-7" />
                      <span className="d6-display mt-4 text-[1.35rem] leading-none font-extrabold">{platform.name}</span>
                      <span className="mt-1.5 text-[0.92rem] font-medium text-[var(--paper-soft)]">{PLATFORM_DETAIL[platform.name]}</span>
                      <span className="mt-auto flex items-center gap-1 pt-4 text-[0.9rem] font-bold">
                        Install guide
                        <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Topics */}
          <section aria-labelledby="topics-title" className="border-t border-[var(--line)] py-16 sm:py-20">
            <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
              <h2 id="topics-title" className="d6-display text-[2rem] leading-tight font-extrabold sm:text-[2.6rem]">
                Every topic, in its folder
              </h2>
              <p className="d6-soft mt-3 max-w-2xl text-[1.05rem]">
                Seven folders, from getting started to account settings. Each link opens the full article.
              </p>
              <FolderBoard
                folders={FOLDERS}
                icons={ICONS}
                extra={
                  <div className="d6-note relative w-full px-6 py-8 sm:px-8" style={noteStyle("cream", 0)}>
                    <Tape className="-top-3 left-12 rotate-[-5deg]" />
                    <h3 className="d6-display text-[2rem] leading-tight font-extrabold sm:text-[2.3rem]">Still stuck?</h3>
                    <p className="mt-2 max-w-lg text-[1.02rem] leading-relaxed font-medium text-[var(--paper-soft)]">
                      Open an issue on GitHub and tell us what you tried. Mention your version (v{pkg.version}) and
                      whether it is the desktop app or the phone.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2.5">
                      <a href={ISSUES_URL} className="d6-btn d6-btn-ink">
                        Open an issue
                        <ArrowUpRight className="size-4" />
                      </a>
                      <a href={REPO_URL} className="d6-btn d6-btn-paper-line">
                        <GitHubMark className="size-4" />
                        Source code
                      </a>
                    </div>
                  </div>
                }
              />
            </div>
          </section>

        </main>
        <DeskFooter />
      </DeskMotion>
    </div>
  );
}
