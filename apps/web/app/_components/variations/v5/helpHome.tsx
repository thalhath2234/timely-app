import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Download, MessageCircleQuestion, Sparkles } from "lucide-react";
import HelpSearch from "@/app/_components/help/helpSearch";
import { ALL_ARTICLES, HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import type { Article, HelpSection } from "@/app/_components/help/types";
import { Reveal } from "@/app/_components/landing/reveal";
import { ISSUES_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { HELP_POPULAR, HELP_QUESTIONS, PLATFORMS } from "@/app/_components/variations/content";
import { Card, RowHead } from "./card";

export const helpMetadata: Metadata = {
  title: { absolute: "Timely Help Center" },
  description: "Install Timely, set up your first week, and learn everything it can do: planning, the assistant, docs and sheets, your account.",
};

const START_FIRST = ["what-is-timely", "first-week"];

function ArticleLink({ section, article, children }: { section: HelpSection; article: Article; children?: ReactNode }) {
  return (
    <li>
      <Link href={articleHref(section, article)} className="v5-article">
        <span className="min-w-0 truncate">{children ?? article.title}</span>
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </li>
  );
}

function SectionIcon({ section }: { section: HelpSection }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--v-line-strong)] bg-[var(--v-bg)] text-[var(--v-primary)]" aria-hidden>
      <section.icon className="size-4" />
    </span>
  );
}

/** One topic as a dashboard card: icon, title, description and every article. */
function SectionCard({ section, delay = 0 }: { section: HelpSection; delay?: number }) {
  return (
    <Reveal delay={delay} className="flex">
      <Card title={section.title} right={`${section.articles.length} articles`} className="w-full">
        <div className="flex items-start gap-3">
          <SectionIcon section={section} />
          <p className="text-sm leading-relaxed text-[var(--v-soft)]">{section.description}</p>
        </div>
        <ul className="mt-3 border-t border-[var(--v-line)] pt-2">
          {section.articles.map((article) => (
            <ArticleLink key={article.slug} section={section} article={article} />
          ))}
        </ul>
      </Card>
    </Reveal>
  );
}

/** The help center's front page: a dashboard of help cards. */
export default function HelpHome() {
  const start = HELP_SECTIONS.find((section) => section.id === "start");
  const install = HELP_SECTIONS.find((section) => section.id === "install");
  const topics = HELP_SECTIONS.filter((section) => section.id !== "start" && section.id !== "install");
  const guides = new Set(PLATFORMS.map((platform) => platform.guide));

  return (
    <div className="v-container pt-8 pb-20 sm:pt-12 sm:pb-24">
      <Reveal>
        <RowHead label="Help center" count={`${ALL_ARTICLES.length} articles`} />
        <div className="mt-5 grid gap-x-10 gap-y-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
          <h1 className="v5-display text-[2.5rem] sm:text-[3rem] lg:text-[3.5rem]">Help, at a glance.</h1>
          <p className="max-w-[44ch] text-[0.9375rem] leading-relaxed text-[var(--v-soft)] lg:pb-1">
            Install Timely, set up your first week, and learn everything it can do. Every article is on this board.
          </p>
        </div>
      </Reveal>

      <div className="v5-grid mt-7 sm:mt-8" style={{ "--cols-sm": 1, "--cols-md": 2, "--cols-lg": 3 } as CSSProperties}>
        {/* Search */}
        <Reveal className="v5-span-full flex">
          <Card title="Search" right={`${SEARCH_INDEX.length} entries`} className="w-full">
            <div className="v5-search relative z-20">
              <HelpSearch entries={SEARCH_INDEX} size="large" />
            </div>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Common questions">
              {HELP_QUESTIONS.map((question) => (
                <li key={question.href}>
                  <Link href={question.href} className="v5-pill !h-9 border-transparent bg-[var(--v-raised)] !text-[0.8125rem] !font-normal text-[var(--v-soft)] hover:text-[var(--v-ink)] sm:!h-8">
                    {question.q}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>

        {/* Start here */}
        {start ? (
          <Reveal className="flex">
            <Card title="Start here" right={`${start.articles.length} articles`} className="w-full">
              <div className="flex items-start gap-3">
                <SectionIcon section={start} />
                <p className="text-sm leading-relaxed text-[var(--v-soft)]">New here? Two short reads take you from install to a planned week.</p>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {START_FIRST.map((slug, index) => {
                  const article = start.articles.find((entry) => entry.slug === slug);
                  if (!article) return null;
                  return (
                    <Link
                      key={slug}
                      href={articleHref(start, article)}
                      className={index === 0 ? "v-btn v-btn-primary !h-10 justify-between !px-3.5 !text-sm" : "v-btn v-btn-ghost !h-10 justify-between !px-3.5 !text-sm"}
                    >
                      {article.title}
                      <ArrowRight className="size-4" />
                    </Link>
                  );
                })}
              </div>
              <ul className="mt-3 border-t border-[var(--v-line)] pt-2">
                {start.articles
                  .filter((article) => !START_FIRST.includes(article.slug))
                  .map((article) => (
                    <ArticleLink key={article.slug} section={start} article={article} />
                  ))}
              </ul>
            </Card>
          </Reveal>
        ) : null}

        {/* Install */}
        {install ? (
          <Reveal delay={0.05} className="v5-span-2 flex">
            <Card title="Install" right={<Download className="size-3.5" aria-hidden />} className="w-full">
              <ul className="grid gap-2 sm:grid-cols-2">
                {PLATFORMS.map((platform) => (
                  <li key={platform.id} className="min-w-0">
                    <Link
                      href={platform.guide}
                      className="group flex min-h-14 items-center gap-3 rounded-lg border border-[var(--v-line)] bg-[var(--v-bg)] px-3 py-2 transition-colors hover:border-[var(--v-line-strong)]"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 14%, transparent)` }} aria-hidden>
                        <platform.mark className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{platform.name}</span>
                        <span className="block truncate text-xs text-[var(--v-soft)]">{platform.note}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-[var(--v-faint)] transition-colors group-hover:text-[var(--v-primary)]" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              <ul className="mt-3 border-t border-[var(--v-line)] pt-2">
                {install.articles
                  .filter((article) => !guides.has(articleHref(install, article) as (typeof PLATFORMS)[number]["guide"]))
                  .map((article) => (
                    <ArticleLink key={article.slug} section={install} article={article}>
                      {article.title}
                      <span className="ml-2 hidden text-xs text-[var(--v-faint)] sm:inline">{article.summary}</span>
                    </ArticleLink>
                  ))}
              </ul>
            </Card>
          </Reveal>
        ) : null}

        {/* Every other topic */}
        {topics.map((section, index) => (
          <SectionCard key={section.id} section={section} delay={(index % 3) * 0.05} />
        ))}

        {/* Popular */}
        <Reveal className="flex">
          <Card title="Popular" right={<Sparkles className="size-3.5" aria-hidden />} className="w-full">
            <ul>
              {HELP_POPULAR.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="v5-article">
                    <span className="min-w-0 truncate">{item.label}</span>
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>

        {/* Still stuck */}
        <Reveal className="v5-span-full flex">
          <Card title="Still stuck" right="2 ways" className="w-full">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--v-line-strong)] bg-[var(--v-bg)] text-[var(--v-primary)]" aria-hidden>
                <MessageCircleQuestion className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold tracking-[-0.01em]">Didn&apos;t find it?</h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--v-soft)]">
                  Open an issue with what you expected and what happened instead, or read the source. Both live on GitHub.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
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
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
