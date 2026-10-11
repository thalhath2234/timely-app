import Link from "next/link";
import { HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import { ISSUES_URL, REPO_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, GitHubMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import pkg from "@/package.json";
import IndexSearch from "./indexSearch";
import { RingInView } from "./inkInView";
import { Page, Rv } from "./ui";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Page-style numbers: every article starts a new page, one page per heading. */
const PAGES = new Map<string, number>();
{
  let page = 3;
  for (const section of HELP_SECTIONS) {
    for (const article of section.articles) {
      PAGES.set(articleHref(section, article), page);
      page += article.sections.length + 1;
    }
  }
}
const pageOf = (href: string) => PAGES.get(href.split("#")[0]) ?? 1;

const POPULAR = [
  { label: "Use your Claude or ChatGPT plan", href: "/help/assistant/subscriptions" },
  { label: "Install on Windows", href: "/help/install/windows" },
  { label: "Auto-schedule", href: "/help/plan/auto-schedule" },
  { label: "Pair your phone", href: "/help/install/android#pair" },
  { label: "Keyboard shortcuts", href: "/help/start/shortcuts" },
  { label: "Connect an agent with MCP", href: "/help/assistant/mcp" },
];

const v = pkg.version;
const INSTALL = [
  { call: "WIN", name: "Windows", Mark: WindowsMark, file: `Timely-${v}-win-x64.exe`, note: "Per-user installer for Windows 10 and 11", href: "/help/install/windows" },
  { call: "UBU", name: "Ubuntu", Mark: UbuntuMark, file: `Timely-${v}-linux-x86_64.AppImage`, note: "One file; needs libfuse2", href: "/help/install/ubuntu" },
  { call: "ARCH", name: "Arch Linux", Mark: ArchMark, file: "timely-bin", note: "From the AUR, updated with pacman", href: "/help/install/arch" },
  { call: "AND", name: "Android", Mark: AndroidMark, file: `Timely-${v}-android-arm64.apk`, note: "Pairs with your computer by QR code", href: "/help/install/android" },
];

/** The help center home as the back-of-book index. */
export default function HelpIndex() {
  const articleCount = HELP_SECTIONS.reduce((sum, section) => sum + section.articles.length, 0);
  return (
    <>
      {/* Title */}
      <section aria-labelledby="index-title" className="relative overflow-x-clip border-b border-[var(--rule-2)]">
        <div aria-hidden className="d2-ruled pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        {/* Bookmark ribbon */}
        <div aria-hidden className="d2-ribbon absolute top-0 right-[8%] hidden w-9 sm:block lg:right-[12%]">
          <div className="h-[260px] bg-[var(--verm)] [clip-path:polygon(0_0,100%_0,100%_100%,50%_86%,0_100%)] lg:h-[330px]" />
        </div>
        <Page className="relative pt-12 pb-14 sm:pt-16 sm:pb-20">
          <p className="d2-kicker">Timely Help Center · {articleCount} articles</p>
          <h1 id="index-title" className="d2-display mt-5 text-[4rem] sm:text-[6.5rem] lg:text-[8rem]">
            Index<span className="text-[var(--verm)]">.</span>
          </h1>
          <p className="d2-soft mt-5 max-w-[46ch] text-lg leading-relaxed sm:text-xl">
            Install Timely, set up your first week, and look up anything it can do.
          </p>
          <div className="relative z-20 mt-10 max-w-[720px]">
            <IndexSearch entries={SEARCH_INDEX} />
          </div>
        </Page>
      </section>

      <Page className="pb-24">
        {/* Popular */}
        <section aria-labelledby="popular-title" className="grid gap-x-10 gap-y-6 border-b border-[var(--rule-2)] py-14 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Rv>
            <h2 id="popular-title" className="relative w-fit">
              <span className="d2-serif text-[1.7rem] leading-tight italic">Most turned-to</span>
              <RingInView className="-top-3 -left-4 h-[calc(100%+24px)] w-[calc(100%+32px)]" />
            </h2>
            <p className="d2-faint mt-3 text-sm">The pages people open first.</p>
          </Rv>
          <Rv as="ol" leader className="grid gap-x-12 sm:grid-cols-2">
            {POPULAR.map((item, index) => (
              <li key={item.href}>
                <Link href={item.href} className="group flex min-h-12 items-baseline gap-2 border-b border-[var(--rule)] py-3">
                  <span className="d2-mono w-5 shrink-0 text-[11px] text-[var(--verm-2)]">{index + 1}</span>
                  <span className="text-[1.02rem] transition-colors group-hover:text-[var(--verm-2)]">{item.label}</span>
                  <span aria-hidden className="d2-leader" />
                  <span className="d2-serif shrink-0 text-[var(--ink-3)] italic">{pageOf(item.href)}</span>
                </Link>
              </li>
            ))}
          </Rv>
        </section>

        {/* Install */}
        <section aria-labelledby="install-title" className="border-b border-[var(--rule-2)] py-14">
          <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <Rv>
              <p className="d2-kicker">Part I</p>
              <h2 id="install-title" className="d2-serif mt-2 text-[1.7rem] leading-tight italic">
                Install
              </h2>
              <p className="d2-faint mt-3 max-w-[30ch] text-sm">A guide for each platform, with the file to download.</p>
            </Rv>
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {INSTALL.map((card, index) => (
                <Rv as="li" key={card.name} delay={index * 90}>
                  <Link
                    href={card.href}
                    className="group relative flex h-full min-h-[220px] flex-col bg-[var(--paper-3)] px-4 pt-3 pb-8 shadow-[0_18px_30px_-18px_rgb(0_0_0/0.9)] transition-transform duration-300 hover:-translate-y-1.5 hover:-rotate-1"
                  >
                    <span aria-hidden className="absolute inset-x-0 top-9 border-t border-[var(--verm)]/80" />
                    <span aria-hidden className="pointer-events-none absolute inset-x-0 top-10 bottom-0 bg-[repeating-linear-gradient(to_bottom,transparent_0_23px,var(--rule)_23px_24px)]" />
                    <span className="relative flex items-center justify-between">
                      <span className="d2-mono text-[11px] tracking-widest text-[var(--ink-3)]">{card.call}·{String(index + 1).padStart(2, "0")}</span>
                      <card.Mark className="size-4 text-[var(--ink-2)]" />
                    </span>
                    <span className="d2-serif relative mt-5 text-[1.4rem] leading-tight">Install on {card.name}</span>
                    <span className="d2-mono relative mt-2 text-[11.5px] leading-6 [overflow-wrap:anywhere] text-[var(--ink)]">{card.file}</span>
                    <span className="relative text-sm leading-6 text-[var(--ink-2)]">{card.note}</span>
                    <span className="d2-serif relative mt-auto pt-3 text-sm text-[var(--ink-3)] italic group-hover:text-[var(--verm-2)]">
                      see p. {pageOf(card.href)} →
                    </span>
                    <span aria-hidden className="absolute bottom-2.5 left-1/2 size-3 -translate-x-1/2 rounded-full bg-[var(--paper)] shadow-[inset_0_1px_2px_rgb(0_0_0/0.8)]" />
                  </Link>
                </Rv>
              ))}
            </ul>
          </div>
        </section>

        {/* Contents */}
        <section aria-labelledby="contents-title" className="py-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b-[3px] border-double border-[var(--rule-3)] pb-4">
            <h2 id="contents-title" className="d2-display text-[2.6rem] sm:text-[3.4rem]">
              Contents
            </h2>
            <p className="d2-kicker">{HELP_SECTIONS.length} parts · {articleCount} articles</p>
          </div>
          <div className="mt-4 grid gap-x-16 lg:grid-cols-2">
            {HELP_SECTIONS.map((section, sectionIndex) => (
              <Rv key={section.id} leader id={section.id} className="border-b border-[var(--rule-2)] py-8">
                <h3 className="flex items-baseline gap-4">
                  <span className="d2-serif w-12 shrink-0 text-[1.9rem] leading-none text-[var(--verm-2)] italic">{ROMAN[sectionIndex]}.</span>
                  <span className="d2-serif text-[1.55rem] leading-tight">{section.title}</span>
                </h3>
                <p className="d2-faint mt-2 pl-16 text-[0.95rem] leading-relaxed">{section.description}</p>
                <ol className="mt-3 pl-16">
                  {section.articles.map((article, articleIndex) => {
                    const href = articleHref(section, article);
                    return (
                      <li key={article.slug}>
                        <Link href={href} className="group relative flex min-h-11 items-baseline gap-2 py-2">
                          <span aria-hidden className="absolute top-1/2 -left-5 h-2 w-2 -translate-y-1/2 scale-0 rounded-full bg-[var(--verm)] transition-transform duration-200 group-hover:scale-100 group-focus-visible:scale-100" />
                          <span className="d2-mono w-8 shrink-0 text-[11px] text-[var(--ink-3)]">
                            {sectionIndex + 1}.{articleIndex + 1}
                          </span>
                          <span className="transition-colors group-hover:text-[var(--verm-2)]">{article.title}</span>
                          <span aria-hidden className="d2-leader" />
                          <span className="d2-serif shrink-0 text-[var(--ink-3)] italic">{pageOf(href)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </Rv>
            ))}
          </div>
        </section>

        {/* Still stuck */}
        <Rv as="section" className="relative mt-6 grid gap-8 border border-[var(--rule-3)] bg-[var(--paper-2)] p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="d2-kicker">Errata and questions</p>
            <h2 className="d2-serif mt-3 text-[2rem] leading-tight sm:text-[2.4rem]">Still stuck?</h2>
            <p className="d2-soft mt-3 max-w-[56ch] leading-relaxed">
              Timely is open source. Ask a question or report a problem on GitHub, and include your platform and Timely
              version.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <a href={ISSUES_URL} className="d2-btn d2-btn-verm !min-h-12 !px-5">
              Open an issue on GitHub
            </a>
            <a href={REPO_URL} className="d2-btn !min-h-12 !px-5">
              <GitHubMark className="size-4" />
              Source code
            </a>
          </div>
          <p aria-hidden className="d2-hand absolute -top-5 right-6 rotate-2 bg-[var(--paper)] px-2 text-[1.4rem] text-[var(--verm-2)]">
            errata welcome
          </p>
        </Rv>
      </Page>
    </>
  );
}
