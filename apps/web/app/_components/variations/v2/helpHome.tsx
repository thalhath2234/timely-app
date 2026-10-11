import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUp, ArrowUpRight } from "lucide-react";
import HelpSearch from "@/app/_components/help/helpSearch";
import { HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import { Reveal } from "@/app/_components/landing/reveal";
import { ISSUES_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { HELP_QUESTIONS, PLATFORMS } from "@/app/_components/variations/content";
import { Bubble, Timely, Turn } from "./turn";

export const helpMetadata: Metadata = {
  title: { absolute: "Timely Help Center" },
  description: "Install Timely, set up your first week, and learn everything the planner and its assistant can do.",
};

/** What each platform's guide installs, short enough for a four-up row. */
const PACKAGE: Record<(typeof PLATFORMS)[number]["id"], string> = {
  windows: "Installer, updates itself",
  ubuntu: "AppImage, updates itself",
  arch: "timely-bin from the AUR",
  android: "APK, pairs by QR code",
};

const INSTALL = HELP_SECTIONS.find((section) => section.id === "install");
const TOPICS = HELP_SECTIONS.filter((section) => section.id !== "install");

/**
 * The help center's front page as the same conversation: a composer to ask
 * in, suggested questions, then every section as an answer card.
 */
export default function HelpHome() {
  return (
    <div className="v-container pb-24 sm:pb-28">
      <section className="mx-auto max-w-3xl pt-10 text-center sm:pt-16">
        <Reveal>
          <h1 className="v2-h text-[2.6rem] sm:text-[3.5rem]">What do you want to know?</h1>
        </Reveal>
        <Reveal delay={0.06} className="relative z-20 mx-auto mt-7 max-w-2xl text-left">
          <div className="v2-ask relative">
            <HelpSearch entries={SEARCH_INDEX} size="large" />
            <span className="v2-ask-send" aria-hidden>
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </span>
          </div>
        </Reveal>
        <Reveal delay={0.12}>
          <ul className="mt-5 flex flex-wrap justify-center gap-2">
            {HELP_QUESTIONS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="v2-chip-link">
                  {item.q}
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      <div className="mt-16 flex flex-col gap-14 sm:mt-20 sm:gap-16">
        {/* Newcomers: Timely speaks first. */}
        <Reveal>
          <Timely>
            <Bubble tail className="max-w-[46rem] !py-5 sm:!py-6">
              <p className="text-lg font-semibold tracking-[-0.01em]">New here?</p>
              <p className="mt-1.5 leading-relaxed text-[var(--v-soft)]">
                Two short articles take you from installing to a planned week.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/help/start/what-is-timely" className="v-btn v-btn-primary !h-10 !text-sm">
                  What is Timely?
                  <ArrowRight className="size-4" />
                </Link>
                <Link href="/help/start/first-week" className="v-btn v-btn-ghost !h-10 !text-sm">
                  Set up your first week
                </Link>
              </div>
            </Bubble>
          </Timely>
        </Reveal>

        {/* Install: the four guides in one answer, then the rest of the section. */}
        {INSTALL ? (
          <Turn you="How do I install it?">
            <div className="v2-card !p-4 sm:!p-5">
              <div className="flex items-center gap-2.5">
                <INSTALL.icon className="size-4 text-[var(--v-primary)]" />
                <h2 className="text-lg font-semibold tracking-[-0.01em]">{INSTALL.title}</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--v-soft)]">{INSTALL.description}</p>
              <ul className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {PLATFORMS.map((platform) => (
                  <li key={platform.id} className="min-w-0">
                    <Link
                      href={platform.guide}
                      className="group flex min-h-[3.75rem] items-center gap-3 rounded-[14px] border border-[var(--v-line)] bg-[var(--v-surface)] px-3 py-2.5 transition-colors hover:border-[var(--v2-you-line)]"
                    >
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
                        style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 14%, transparent)` }}
                      >
                        <platform.mark className="size-[1.1rem]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{platform.name}</span>
                        <span className="block text-xs text-[var(--v-soft)]">{PACKAGE[platform.id]}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-[var(--v-faint)] transition-colors group-hover:text-[var(--v-primary)]" />
                    </Link>
                  </li>
                ))}
              </ul>
              <ul className="mt-3 border-t border-[var(--v-line)] pt-2">
                {INSTALL.articles
                  .filter((article) => !PLATFORMS.some((platform) => platform.guide === articleHref(INSTALL, article)))
                  .map((article) => (
                  <li key={article.slug}>
                    <Link href={articleHref(INSTALL, article)} className="v2-article">
                      {article.title}
                      <ArrowRight className="size-4" />
                    </Link>
                  </li>
                  ))}
              </ul>
            </div>
          </Turn>
        ) : null}

        {/* Every other section, every article. */}
        <Turn you="I'd rather browse. What is in here?">
          <div className="gap-3.5 lg:columns-2">
            {TOPICS.map((section) => (
              <article key={section.id} id={section.id} className="v2-card mb-3.5 break-inside-avoid !p-4 last:mb-0 sm:!p-5">
                <div className="flex items-center gap-2.5">
                  <section.icon className="size-4 text-[var(--v-primary)]" />
                  <h2 className="text-lg font-semibold tracking-[-0.01em]">{section.title}</h2>
                  <span className="ml-auto text-xs text-[var(--v-faint)]">{section.articles.length} articles</span>
                </div>
                <p className="mt-1 text-sm text-[var(--v-soft)]">{section.description}</p>
                <ul className="mt-3 border-t border-[var(--v-line)] pt-2">
                  {section.articles.map((article) => (
                    <li key={article.slug}>
                      <Link href={articleHref(section, article)} className="v2-article">
                        {article.title}
                        <ArrowRight className="size-4" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </Turn>

        {/* Still stuck: the last turn. */}
        <Turn you="I still can't find it.">
          <Bubble tail className="max-w-[46rem] !py-5 sm:!py-6">
            <p className="text-lg font-semibold tracking-[-0.01em]">Ask on GitHub.</p>
            <p className="mt-1.5 leading-relaxed text-[var(--v-soft)]">
              Timely is open source. Open an issue with your platform and version (Settings → Server shows it in the
              desktop app) and we will have a look.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={ISSUES_URL} className="v-btn v-btn-primary !h-10 !text-sm">
                Open an issue
                <ArrowUpRight className="size-4" />
              </a>
              <a href={REPO_URL} className="v-btn v-btn-ghost !h-10 !text-sm">
                <GitHubMark className="size-4" />
                Source
              </a>
            </div>
          </Bubble>
        </Turn>
      </div>
    </div>
  );
}
