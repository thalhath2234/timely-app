import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, MessageCircleQuestion } from "lucide-react";
import HelpSearch from "@/app/_components/help/helpSearch";
import { ALL_ARTICLES, HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import type { Article, HelpSection } from "@/app/_components/help/types";
import { ISSUES_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { HELP_POPULAR, PALETTE, PLATFORMS } from "@/app/_components/variations/content";
import { cn } from "@/app/utils/cn";
import { ColumnHead } from "./column";
import HelpBoard from "./helpBoard";

export const helpMetadata: Metadata = {
  title: { absolute: "Timely Help Center" },
  description: "Install Timely, set up your first week and learn everything it can do, one section at a time.",
};

/** One colour per help section, so a lane is recognisable at a glance. */
const SECTION_COLORS: Record<string, string> = {
  start: PALETTE.green,
  install: PALETTE.cyan,
  plan: PALETTE.blue,
  organize: PALETTE.violet,
  notes: PALETTE.amber,
  assistant: PALETTE.primary,
  account: PALETTE.teal,
};

const NEWCOMER_SLUGS = ["what-is-timely", "first-week"];

/** Design 3: the help center as a board, every section a lane of article cards. */
export default function HelpHome() {
  const start = HELP_SECTIONS.find((section) => section.id === "start");
  const install = HELP_SECTIONS.find((section) => section.id === "install");
  const lanes = HELP_SECTIONS.filter((section) => section.id !== "start" && section.id !== "install");

  return (
    <>
      <section className="pt-8 pb-8 sm:pt-12">
        <div className="v-container">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--v-faint)]">
            <span aria-hidden className="v3-dot" style={{ "--c": "var(--v-primary)" } as CSSProperties} />
            <span className="v3-mono">Help center</span>
            <span className="v3-mono">
              {HELP_SECTIONS.length} sections · {ALL_ARTICLES.length} articles
            </span>
          </div>
          <h1 className="v3-display mt-4 text-[2.6rem] sm:text-[3.4rem] lg:text-[4.25rem]">Everything, by stage.</h1>
          <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="v3-search w-full lg:max-w-sm">
              <HelpSearch entries={SEARCH_INDEX} size="small" />
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label="Popular articles">
              {HELP_POPULAR.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="v3-pill">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Lane 1: newcomers and install guides side by side. */}
      <section aria-label="Start here and install" className="pb-8">
        <div className="v-container grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {start ? <StartLane section={start} /> : null}
          {install ? <InstallLane section={install} /> : null}
        </div>
      </section>

      {/* The board: one lane per remaining section. */}
      <section aria-labelledby="board-title" className="pb-10">
        <HelpBoard
          toolbar={
            <ColumnHead color={PALETTE.primary} label="Board" count={lanes.length} className="!border-t-0 !pt-0">
              <h2 id="board-title" className="v3-display mt-2 text-[1.75rem] sm:text-[2.1rem]">
                Every section, every article.
              </h2>
            </ColumnHead>
          }
        >
          {lanes.map((section) => (
            <Lane key={section.id} section={section} />
          ))}
        </HelpBoard>
      </section>

      <section aria-labelledby="stuck-title" className="pb-16 lg:pb-24">
        <div className="v-container">
          <div className="v3-card p-5 sm:p-6 lg:p-8">
            <ColumnHead color={PALETTE.amber} label="Done?" count={1} className="!border-t-0 !pt-0" />
            <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <span className="flex size-10 flex-none items-center justify-center rounded-[var(--v-radius)] border border-[var(--v-line)] text-[var(--v-primary)]">
                  <MessageCircleQuestion className="size-5" />
                </span>
                <div>
                  <h2 id="stuck-title" className="text-xl font-semibold tracking-[-0.01em]">
                    Still stuck?
                  </h2>
                  <p className="mt-1 max-w-lg text-sm leading-relaxed text-[var(--v-soft)]">
                    Open an issue with what you tried and what you saw, or read the source. It is all public.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <a href={ISSUES_URL} className="v-btn v-btn-primary !h-10 !text-sm">
                  Open an issue
                  <ArrowUpRight className="size-4" />
                </a>
                <a href={REPO_URL} className="v-btn v-btn-ghost !h-10 !text-sm">
                  <GitHubMark className="size-4" />
                  Source
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---- Lanes ---- */

function LaneHead({ section, label }: { section: HelpSection; label?: string }) {
  return (
    <ColumnHead
      color={SECTION_COLORS[section.id] ?? PALETTE.primary}
      label={label ?? section.title}
      count={section.articles.length}
      icon={<section.icon className="size-3.5 flex-none" />}
    />
  );
}

function ArticleCard({ section, article, big }: { section: HelpSection; article: Article; big?: boolean }) {
  return (
    <Link href={articleHref(section, article)} className={cn("v3-card v3-card-link gap-1 px-3.5 py-3", big && "min-h-24 justify-end py-4")}>
      <span className={cn("flex items-start justify-between gap-2 font-medium", big ? "text-base" : "text-sm")}>
        {article.title}
        <ArrowRight className="mt-1 size-3.5 flex-none text-[var(--v-faint)]" />
      </span>
      <span className="line-clamp-2 text-xs leading-relaxed text-[var(--v-soft)]">{article.summary}</span>
    </Link>
  );
}

/** A compact row for an article that is not one of a lane's main cards. */
function ArticleRow({ section, article }: { section: HelpSection; article: Article }) {
  return (
    <Link
      href={articleHref(section, article)}
      className="flex min-h-10 items-center justify-between gap-2 rounded-[var(--v-radius)] px-3 text-sm text-[var(--v-soft)] transition-colors hover:bg-[var(--v-raised)] hover:text-[var(--v-ink)]"
    >
      {article.title}
      <ArrowRight className="size-3.5 flex-none text-[var(--v-faint)]" />
    </Link>
  );
}

function StartLane({ section }: { section: HelpSection }) {
  const main = NEWCOMER_SLUGS.map((slug) => section.articles.find((article) => article.slug === slug)).filter(
    (article): article is Article => Boolean(article),
  );
  const rest = section.articles.filter((article) => !NEWCOMER_SLUGS.includes(article.slug));
  return (
    <div className="v3-lane">
      <LaneHead section={section} label="Start here" />
      <div className="v3-lane-cards">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {main.map((article) => (
            <ArticleCard key={article.slug} section={section} article={article} big />
          ))}
        </div>
        {rest.length ? (
          <div className="mt-1 flex flex-col">
            {rest.map((article) => (
              <ArticleRow key={article.slug} section={section} article={article} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InstallLane({ section }: { section: HelpSection }) {
  const guides = PLATFORMS.map((platform) => ({
    platform,
    article: section.articles.find((article) => articleHref(section, article) === platform.guide),
  }));
  const guided = new Set(guides.map(({ article }) => article?.slug));
  const rest = section.articles.filter((article) => !guided.has(article.slug));
  return (
    <div className="v3-lane">
      <LaneHead section={section} />
      <div className="v3-lane-cards">
        <div className="grid gap-2 sm:grid-cols-2">
          {guides.map(({ platform, article }) => (
            <Link key={platform.id} href={platform.guide} className="v3-card v3-card-link v3-card-row gap-3 px-3.5 py-3">
              <span
                className="flex size-9 flex-none items-center justify-center rounded-[var(--v-radius)] border border-[var(--v-line)]"
                style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 12%, transparent)` }}
              >
                <platform.mark className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{article?.title ?? `Install on ${platform.name}`}</span>
                <span className="block truncate text-xs text-[var(--v-soft)]">{platform.note}</span>
              </span>
              <ArrowRight className="size-3.5 flex-none text-[var(--v-faint)]" />
            </Link>
          ))}
        </div>
        {rest.length ? (
          <div className="mt-1 flex flex-col">
            {rest.map((article) => (
              <ArticleRow key={article.slug} section={section} article={article} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Lane({ section }: { section: HelpSection }) {
  return (
    <div className="v3-lane">
      <LaneHead section={section} />
      <p className="px-3.5 pb-3 text-xs leading-relaxed text-[var(--v-soft)]">{section.description}</p>
      <div className="v3-lane-cards">
        {section.articles.map((article) => (
          <ArticleCard key={article.slug} section={section} article={article} />
        ))}
      </div>
    </div>
  );
}
