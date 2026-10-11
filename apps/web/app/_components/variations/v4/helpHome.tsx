import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, MessageCircleQuestion, Pin, Star } from "lucide-react";
import HelpSearch from "@/app/_components/help/helpSearch";
import { HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import { ISSUES_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { HELP_POPULAR, PALETTE, PLATFORMS } from "@/app/_components/variations/content";
import { RangeHeader, SheetFrame, TableHead } from "./sheetChrome";

export const helpMetadata: Metadata = {
  title: { absolute: "Timely Help Center" },
  description: "Install Timely, set up your first week, run the assistant on your own subscription, and learn everything it can do. Every article, one row each.",
};

/** The table's columns: # | Article | Section | Summary. The column letters follow them. */
const COLS = "3.5rem minmax(0,1.3fr) minmax(0,0.75fr) minmax(0,1.9fr)";

const SECTION_COLORS: Record<string, string> = {
  start: PALETTE.green,
  install: PALETTE.blue,
  plan: PALETTE.violet,
  organize: PALETTE.amber,
  notes: PALETTE.cyan,
  assistant: PALETTE.pink,
  account: PALETTE.teal,
};

/** Install is pinned to the top; the rest keep the registry's reading order. */
const GROUPS = [...HELP_SECTIONS].sort((a, b) => Number(b.id === "install") - Number(a.id === "install"));
const ARTICLE_COUNT = HELP_SECTIONS.reduce((sum, section) => sum + section.articles.length, 0);

/** Every article row, numbered once across all groups (Install first). */
const NUMBERED = (() => {
  let n = 0;
  return GROUPS.map((section) => ({
    section,
    rows: section.articles.map((article) => ({ article, number: ++n, href: articleHref(section, article) })),
  }));
})();
const LAST_ROW = ARTICLE_COUNT;

const STUCK = [
  { label: "Open an issue", href: ISSUES_URL, where: "GitHub issues", summary: "Ask a question or report a problem. Include your platform and version (Settings → Server shows it)." },
  { label: "Read the source", href: REPO_URL, where: "GitHub", summary: "Timely is open source under the MIT licence. Browse the code, the migrations and the release notes." },
];

function rowStyle(color?: string) {
  return { "--cols": COLS, ...(color ? { "--c": color } : {}) } as CSSProperties;
}

/** A coloured group header row: icon, title, count and the section's one-line description. */
function GroupRow({ color, icon: Icon, title, count, description, pinned }: { color: string; icon: React.ComponentType<{ className?: string }>; title: string; count?: number; description: string; pinned?: boolean }) {
  return (
    <div className="v4-tr v4-fill !grid-cols-1" style={rowStyle(color)}>
      <span className="v4-td flex-wrap gap-x-3 gap-y-1 !py-2.5">
        <Icon className="size-4 shrink-0" />
        <span className="text-[0.9375rem] font-semibold">{title}</span>
        {count !== undefined ? <span className="v4-mono text-[0.6875rem] text-[var(--v-soft)]">{count} rows</span> : null}
        {pinned ? (
          <span className="v4-mono inline-flex items-center gap-1 text-[0.6875rem] text-[var(--v-soft)]">
            <Pin className="size-3" />
            pinned
          </span>
        ) : null}
        <span className="hidden text-sm text-[var(--v-soft)] md:ml-auto md:inline">{description}</span>
      </span>
    </div>
  );
}

/** Design 4's help center: every article is a row of one sheet, grouped by section. */
export default function HelpHome() {
  return (
    <>
      {/* The toolbar sits where the landing page keeps its formula bar. */}
      <div className="v4-fbar">
        <div className="v-container v4-fbar-inner">
          <span className="v4-ref">A1</span>
          <span className="v4-fx hidden sm:inline">fx</span>
          <span className="v4-mono hidden shrink-0 text-xs text-[var(--v-soft)] sm:inline">Filter rows</span>
          <div className="v4-search min-w-0 flex-1 sm:max-w-md">
            <HelpSearch entries={SEARCH_INDEX} size="small" />
          </div>
          <span className="v4-mono ml-auto hidden text-[0.6875rem] text-[var(--v-faint)] lg:inline">
            {ARTICLE_COUNT} rows · {HELP_SECTIONS.length} groups
          </span>
        </div>
      </div>

      <SheetFrame letters={["A", "B", "C", "D"]} cols={COLS} mainClassName="v4-main-rows">
        <section className="pt-[44px] pb-[88px] lg:pb-[132px]">
          <RangeHeader
            className="pl-3 lg:pl-5"
            as="h1"
            name="help_center"
            range={`A1:D${ARTICLE_COUNT + GROUPS.length + 6}`}
            title="Every answer, one row each."
            lede="Install Timely, set up your first week, and learn everything it can do. Filter the rows above, or jump in with a quick filter."
          />

          <div className="mt-5 flex flex-wrap items-center gap-2 pl-3 lg:pl-5" aria-label="Popular articles">
            <span className="v4-mono mr-1 text-[0.6875rem] text-[var(--v-faint)]">quick filters</span>
            {HELP_POPULAR.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-10 items-center rounded-[3px] border border-[var(--v-line-strong)] bg-[var(--v-surface)] px-3 text-[0.8125rem] font-medium text-[var(--v-soft)] transition-colors hover:border-[var(--v-primary)] hover:text-[var(--v-ink)] sm:min-h-9"
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Frozen row: the way in for newcomers stays on screen on desktop. */}
          <div className="v4-frozen mt-8 lg:mt-11">
            <div className="v4-table grid border-b-2 !border-b-[var(--v-primary)] sm:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)]">
              <span className="v4-td v4-fill v4-mono max-sm:!hidden text-[0.6875rem] text-[var(--v-primary)]" style={{ "--c": PALETTE.primary } as CSSProperties} aria-hidden>
                <Star className="size-3.5" />
              </span>
              <Link href="/help/start/what-is-timely" className="group flex min-h-[44px] items-center gap-2 border-b border-[var(--v-line)] px-3.5 text-sm transition-colors hover:bg-[color-mix(in_oklch,var(--v-primary)_7%,var(--v-surface))] sm:border-r sm:border-b-0">
                <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)] sm:hidden">★</span>
                <span className="text-[var(--v-soft)]">New here?</span>
                <span className="font-medium">What is Timely?</span>
                <ArrowRight className="ml-auto size-4 text-[var(--v-faint)] transition-colors group-hover:text-[var(--v-primary)]" />
              </Link>
              <Link href="/help/start/first-week" className="group flex min-h-[44px] items-center gap-2 px-3.5 text-sm transition-colors hover:bg-[color-mix(in_oklch,var(--v-primary)_7%,var(--v-surface))]">
                <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)] sm:hidden">★</span>
                <span className="text-[var(--v-soft)]">Then</span>
                <span className="font-medium">Set up your first week</span>
                <ArrowRight className="ml-auto size-4 text-[var(--v-faint)] transition-colors group-hover:text-[var(--v-primary)]" />
              </Link>
            </div>
          </div>

          <div className="v4-table border-t-0">
            <TableHead
              cols={COLS}
              className="max-md:!hidden"
              columns={[
                { letter: "A", label: "#" },
                { letter: "B", label: "Article" },
                { letter: "C", label: "Section" },
                { letter: "D", label: "Summary" },
              ]}
            />

            {NUMBERED.map(({ section, rows }) => {
              const color = SECTION_COLORS[section.id] ?? PALETTE.primary;
              return (
                <div key={section.id} id={section.id} className="scroll-mt-40">
                  <GroupRow
                    color={color}
                    icon={section.icon}
                    title={section.title}
                    count={section.articles.length}
                    description={section.description}
                    pinned={section.id === "install"}
                  />
                  {rows.map(({ article, number, href }) => {
                    const platform = PLATFORMS.find((item) => item.guide === href);
                    return (
                      <Link key={article.slug} href={href} className="v4-tr v4-stack" style={rowStyle(color)}>
                        <span className="v4-td v4-td-mono !gap-2 md:justify-end">
                          {number}
                          <span className="md:hidden">· {section.title}</span>
                        </span>
                        <span className="v4-td text-[0.9375rem] font-medium">
                          {platform ? (
                            <span className="shrink-0" style={{ color: platform.color }}>
                              <platform.mark className="size-4" />
                            </span>
                          ) : null}
                          {article.title}
                        </span>
                        <span className="v4-td v4-stack-hide text-sm text-[var(--v-soft)]">{section.title}</span>
                        <span className="v4-td text-sm leading-relaxed text-[var(--v-soft)]">{article.summary}</span>
                      </Link>
                    );
                  })}
                </div>
              );
            })}

            {/* The last group: still stuck. */}
            <div id="stuck" className="scroll-mt-40">
              <GroupRow color={PALETTE.primary} icon={MessageCircleQuestion} title="Didn't find it?" description="Timely is open source. Ask on GitHub, or read the code." />
              {STUCK.map((item, index) => {
                return (
                  <a key={item.href} href={item.href} className="v4-tr v4-stack" style={rowStyle(PALETTE.primary)}>
                    <span className="v4-td v4-td-mono !gap-2 md:justify-end">
                      {LAST_ROW + index + 1}
                      <span className="md:hidden">· {item.where}</span>
                    </span>
                    <span className="v4-td text-[0.9375rem] font-medium">
                      <GitHubMark className="size-4 shrink-0 text-[var(--v-soft)]" />
                      {item.label}
                      <ArrowUpRight className="size-3.5 text-[var(--v-faint)]" />
                    </span>
                    <span className="v4-td v4-stack-hide text-sm text-[var(--v-soft)]">{item.where}</span>
                    <span className="v4-td text-sm leading-relaxed text-[var(--v-soft)]">{item.summary}</span>
                  </a>
                );
              })}
            </div>
          </div>

          <p className="v4-mono mt-5 pl-3 text-xs text-[var(--v-faint)] lg:pl-5">
            {LAST_ROW + STUCK.length} rows · articles open at /help/… ·{" "}
            <Link href="/4" className="text-[var(--v-soft)] hover:text-[var(--v-ink)]">
              back to the landing page
            </Link>
          </p>
        </section>
      </SheetFrame>
    </>
  );
}
