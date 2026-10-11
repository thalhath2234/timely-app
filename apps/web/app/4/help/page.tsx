import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import packageJson from "@/package.json";
import { ALL_ARTICLES, HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import { ISSUES_URL, LATEST_RELEASE_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { C, type ColorName } from "../_parts/data";
import { PLATFORMS } from "../_parts/downloads";
import { fontClasses } from "../_parts/fonts";
import Footer from "../_parts/footer";
import Header from "../_parts/header";
import HelpSearch from "../_parts/helpSearch";
import HeroTitle from "../_parts/heroTitle";
import { KineticHeading, MotionRoot, Rise, Wipe } from "../_parts/kinetic";
import "../_parts/design.css";

export const metadata: Metadata = { title: { absolute: "Timely Help Center · Design 4" } };

const SECTION_COLORS: ColorName[] = ["amber", "blue", "violet", "green", "cyan", "pink", "orange"];

const POPULAR: [string, string][] = [
  ["start", "what-is-timely"],
  ["start", "first-week"],
  ["plan", "auto-schedule"],
  ["assistant", "subscriptions"],
  ["install", "android"],
  ["account", "backups"],
];

const pad = (value: number) => String(value).padStart(2, "0");

export default function DesignFourHelp() {
  const popular = POPULAR.map(([section, slug]) => ALL_ARTICLES.find((ref) => ref.section.id === section && ref.article.slug === slug)).filter(
    (ref): ref is (typeof ALL_ARTICLES)[number] => Boolean(ref),
  );
  const install = HELP_SECTIONS.find((section) => section.id === "install");

  return (
    <div className={`d4 ${fontClasses}`}>
      <div className="d4-gridlines" aria-hidden />
      <MotionRoot>
        <Header />
        <main id="main-content">
          {/* ---- Title and search ---- */}
          <section aria-labelledby="d4-help-title" className="d4-wrap pt-5 pb-16 md:pt-7 md:pb-24">
            <div className="d4-cols d4-label gap-y-1 text-[11px] text-[var(--soft)]">
              <span className="col-span-2 md:col-span-3">Help center</span>
              <span className="col-span-2 md:col-span-3">
                {HELP_SECTIONS.length} topics · {ALL_ARTICLES.length} articles
              </span>
              <span className="hidden md:col-span-3 md:block">Timely {packageJson.version}</span>
              <span className="hidden md:col-span-3 md:block">Windows · Ubuntu · Arch · Android</span>
            </div>

            <div className="d4-cols mt-5 gap-y-10 md:mt-7">
              <div id="d4-help-title" className="col-span-4 md:col-span-5">
                <HeroTitle lines={["How can", "we help?"]} className="d4-display text-[clamp(3.4rem,8.4vw,8rem)]" />
              </div>
              <div className="col-span-4 self-end md:col-span-7 md:pl-10">
                <HelpSearch entries={SEARCH_INDEX} />
              </div>
            </div>

            <div className="mt-14 md:mt-20">
              <h2 className="d4-label flex items-center justify-between border-t-2 border-[var(--ink)] pt-3">
                <span>Popular</span>
                <span className="d4-faint font-normal normal-case tracking-normal">Most read first</span>
              </h2>
              <ol className="mt-px grid gap-px border-b border-[var(--line-2)] bg-[var(--line-2)] md:grid-cols-2 lg:grid-cols-3">
                {popular.map((ref, index) => (
                  <li key={ref.href} className="bg-[var(--bg)]">
                    <Link href={ref.href} className="d4-row group flex min-h-[84px] items-start gap-4 px-0 py-4 md:px-4" style={{ "--c": C[SECTION_COLORS[index]].bg } as React.CSSProperties}>
                      <span className="d4-num pt-1 text-[28px] text-[var(--faint)] transition-colors group-hover:text-[var(--ink)]">{pad(index + 1)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] leading-tight font-bold tracking-[-0.02em]">{ref.article.title}</span>
                        <span className="mt-1 block text-[13.5px] leading-snug text-[var(--soft)]">{ref.article.summary}</span>
                      </span>
                      <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-[var(--faint)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--ink)]" />
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ---- Install ---- */}
          <section aria-labelledby="d4-help-install" className="d4-wrap pb-16 md:pb-24">
            <div className="flex items-end justify-between gap-4 border-t-2 border-[var(--ink)] pt-3">
              <h2 id="d4-help-install" className="d4-label">
                Install
              </h2>
              <Link href="/help/install/updates-and-data" className="d4-link text-[13px]">
                Updates, data and backups
              </Link>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {PLATFORMS.map((platform, index) => (
                <Rise key={platform.name} delay={index * 0.07} distance={40}>
                  <Link
                    href={platform.guide}
                    className="group relative flex h-full min-h-[200px] flex-col justify-between p-4 text-[#0a0a0a] transition-[filter] hover:brightness-110 sm:min-h-[240px] sm:p-5"
                    style={{ background: platform.color }}
                  >
                    <span className="flex items-start justify-between">
                      <span className="d4-mono text-[12px] font-semibold">{pad(index + 1)}</span>
                      <platform.mark className="size-7" />
                    </span>
                    <span>
                      <span className="block text-[2rem] leading-none font-extrabold tracking-[-0.05em] sm:text-[2.3rem]">{platform.name}</span>
                      <span className="d4-mono mt-2 block truncate text-[12px] font-medium">{platform.file}</span>
                      <span className="mt-4 flex items-center justify-between border-t border-[rgb(10_10_10/30%)] pt-3 text-[14px] font-bold">
                        Install guide
                        <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </span>
                  </Link>
                </Rise>
              ))}
            </div>
            {install ? (
              <p className="d4-body mt-4">
                {install.description} Downloads are on the{" "}
                <a href={LATEST_RELEASE_URL} className="d4-link">
                  latest release
                </a>
                .
              </p>
            ) : null}
          </section>

          {/* ---- The index ---- */}
          <section aria-labelledby="d4-help-index" className="d4-wrap pb-20 md:pb-28">
            <div className="flex items-end justify-between gap-4 border-t-2 border-[var(--ink)] pt-3">
              <h2 id="d4-help-index" className="d4-label">
                Index
              </h2>
              <span className="d4-label text-[var(--faint)]">
                {HELP_SECTIONS.length} topics · {ALL_ARTICLES.length} articles
              </span>
            </div>

            <div className="d4-label mt-6 hidden grid-cols-12 border-b border-[var(--line-2)] pb-2 text-[10.5px] text-[var(--faint)] md:grid">
              <span className="col-span-1">No.</span>
              <span className="col-span-4">Topic</span>
              <span className="col-span-7">Articles</span>
            </div>

            {HELP_SECTIONS.map((section, sectionIndex) => {
              const color = C[SECTION_COLORS[sectionIndex % SECTION_COLORS.length]].bg;
              return (
                <article key={section.id} aria-labelledby={`d4-topic-${section.id}`} className="d4-cols border-b border-[var(--line-2)] py-8 md:py-10">
                  <div className="col-span-4 flex items-start gap-4 md:col-span-5 md:pr-10">
                    <span className="d4-num w-[1.3em] shrink-0 pt-1 text-[44px] md:text-[56px]" style={{ color }} aria-hidden>
                      {pad(sectionIndex + 1)}
                    </span>
                    <div className="min-w-0">
                      <KineticHeading as="h3" id={`d4-topic-${section.id}`} className="text-[1.9rem] leading-[0.95] md:text-[2.4rem]" from={300} to={760}>
                        {section.title}
                      </KineticHeading>
                      <p className="d4-body mt-3 max-w-[36ch]">{section.description}</p>
                      <Wipe color={color} className="mt-4 h-1.5 w-16" />
                    </div>
                  </div>
                  <ol className="col-span-4 mt-6 border-t border-[var(--line)] md:col-span-7 md:mt-0 md:border-t-0">
                    {section.articles.map((article, articleIndex) => (
                      <li key={article.slug} className="border-b border-[var(--line)] last:border-b-0 md:first:border-t md:first:border-[var(--line)]">
                        <Link
                          href={articleHref(section, article)}
                          className="d4-row group grid min-h-12 grid-cols-[44px_minmax(0,1fr)_20px] items-baseline gap-x-2 py-3 md:grid-cols-[56px_minmax(0,0.9fr)_minmax(0,1.1fr)_20px] md:pl-3"
                          style={{ "--c": color } as React.CSSProperties}
                        >
                          <span className="d4-mono text-[11.5px] text-[var(--faint)]">
                            {sectionIndex + 1}.{articleIndex + 1}
                          </span>
                          <span className="text-[16px] leading-snug font-semibold tracking-[-0.015em]">{article.title}</span>
                          <span className="col-start-2 text-[13.5px] leading-snug text-[var(--soft)] md:col-start-auto">{article.summary}</span>
                          <ArrowRight
                            aria-hidden
                            className="col-start-3 row-start-1 size-4 self-center text-[var(--faint)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--ink)] md:col-start-4"
                          />
                        </Link>
                      </li>
                    ))}
                  </ol>
                </article>
              );
            })}
          </section>

          {/* ---- Still stuck ---- */}
          <section aria-labelledby="d4-help-stuck" className="d4-wrap pb-20 md:pb-28">
            <div className="d4-cols border-2 border-[var(--ink)]">
              <div className="col-span-4 border-b-2 border-[var(--ink)] p-5 md:col-span-7 md:border-r-2 md:border-b-0 md:p-8">
                <KineticHeading id="d4-help-stuck" className="text-[clamp(2.6rem,6vw,5.5rem)] leading-[0.9]" from={250} to={820}>
                  Still stuck?
                </KineticHeading>
                <p className="d4-lead mt-5 max-w-[46ch]">
                  Open an issue on GitHub with what you tried and what happened. Include your Timely version ({packageJson.version}) and
                  platform.
                </p>
              </div>
              <div className="col-span-4 flex flex-col justify-end gap-2 p-5 md:col-span-5 md:p-8">
                <a href={ISSUES_URL} className="d4-btn d4-btn-solid justify-between">
                  Open an issue
                  <ArrowUpRight aria-hidden className="size-4" />
                </a>
                <a href={REPO_URL} className="d4-btn justify-between">
                  <span className="flex items-center gap-2">
                    <GitHubMark className="size-4" />
                    Read the code
                  </span>
                  <ArrowUpRight aria-hidden className="size-4" />
                </a>
                <Link href="/help/start/shortcuts" className="d4-btn justify-between">
                  Keyboard shortcuts
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              </div>
            </div>
          </section>
        </main>
        <Footer />
      </MotionRoot>
    </div>
  );
}
