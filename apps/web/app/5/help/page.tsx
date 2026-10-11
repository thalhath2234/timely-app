import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { ALL_ARTICLES, HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import { ISSUES_URL, REPO_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, GitHubMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import Footer from "../_parts/footer";
import Header from "../_parts/header";
import { DrawLine, TopicRing } from "../_parts/helpParts";
import HelpSearch from "../_parts/helpSearch";
import Shell from "../_parts/shell";

export const metadata: Metadata = {
  title: { absolute: "Timely Help Center · Design 5" },
};

const POPULAR = [
  {
    label: "Use your Claude or ChatGPT plan",
    href: "/help/assistant/subscriptions",
  },
  { label: "Auto-schedule", href: "/help/plan/auto-schedule" },
  { label: "Pair your phone", href: "/help/install/android#pair" },
  { label: "Keyboard shortcuts", href: "/help/start/shortcuts" },
  { label: "Connect an agent", href: "/help/assistant/mcp" },
];

const PLATFORMS = [
  {
    name: "Windows",
    detail: "Installer for Windows 10 and 11",
    mark: WindowsMark,
    href: "/help/install/windows",
  },
  {
    name: "Ubuntu",
    detail: "AppImage; needs libfuse2",
    mark: UbuntuMark,
    href: "/help/install/ubuntu",
  },
  {
    name: "Arch Linux",
    detail: "timely-bin from the AUR",
    mark: ArchMark,
    href: "/help/install/arch",
  },
  {
    name: "Android",
    detail: "APK that pairs by QR code",
    mark: AndroidMark,
    href: "/help/install/android",
  },
];

/** Design iteration 5: the help center home. Articles stay at /help/<section>/<article>. */
export default function DesignFiveHelp() {
  const rings = HELP_SECTIONS.map(({ id, articles }) => ({
    id,
    count: articles.length,
  }));
  return (
    <Shell>
      <Header />
      <main id="main-content">
        <section className="wrap hh" aria-labelledby="d5-help-title">
          <div className="min-w-0">
            <p className="label flex items-center gap-2.5">
              <span className="inline-block size-1.5 rounded-full bg-[var(--mint)]" />
              Timely Help Center
            </p>
            <h1 id="d5-help-title" className="mt-6">
              What do you need <span className="it">help with?</span>
            </h1>
            <p className="mt-5 max-w-[36rem] text-[19px] text-[var(--soft)]">
              Install Timely, set up your first week, and learn the rest at your own pace.
            </p>
            <HelpSearch entries={SEARCH_INDEX} />
            <div className="pop">
              <span className="mr-1 text-[var(--faint)]">Often read:</span>
              {POPULAR.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <TopicRing sections={rings} articles={ALL_ARTICLES.length} />
        </section>

        <section className="wrap pb-6" aria-labelledby="d5-install-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-[var(--line)] pt-10">
            <h2 id="d5-install-title" className="text-[26px] font-normal tracking-[-0.02em]">
              Start with <span className="it text-[var(--mint)]">installing</span>
            </h2>
            <Link href="/5#download" className="link text-[15.5px]">
              Download links
            </Link>
          </div>
          <ul className="inst">
            {PLATFORMS.map((platform) => (
              <li key={platform.name}>
                <Link href={platform.href} className="h-full">
                  <platform.mark className="mb-auto size-6 text-[var(--mint)]" />
                  <span className="mt-4 flex items-center justify-between gap-2 text-[18px] font-semibold">
                    {platform.name}
                    <ArrowRight className="size-4 text-[var(--faint)]" aria-hidden />
                  </span>
                  <span className="text-[14.5px] text-[var(--soft)]">{platform.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="wrap pt-16" aria-labelledby="d5-topics-title">
          <h2 id="d5-topics-title" className="text-[26px] font-normal tracking-[-0.02em]">
            Every topic, <span className="it text-[var(--mint)]">in reading order</span>
          </h2>
          <div className="topics">
            {HELP_SECTIONS.map((section, index) => (
              <article key={section.id} className="topic relative" aria-labelledby={`topic-${section.id}`}>
                <DrawLine />
                <div>
                  <p className="num text-[13px] text-[var(--faint)]">
                    {String(index + 1).padStart(2, "0")} · {section.articles.length} articles
                  </p>
                  <h3 id={`topic-${section.id}`} className="mt-2">
                    <section.icon className="size-5 shrink-0 text-[var(--mint)]" aria-hidden />
                    {section.title}
                  </h3>
                  <p className="mt-2 text-[15.5px] text-[var(--soft)]">{section.description}</p>
                </div>
                <ul className="topic-arts">
                  {section.articles.map((article) => (
                    <li key={article.slug}>
                      <Link href={articleHref(section, article)}>
                        <span>{article.title}</span>
                        <ArrowRight className="size-4 shrink-0 self-center text-[var(--faint)]" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="wrap" aria-labelledby="d5-stuck-title">
          <div className="stuck">
            <span className="brk-orb" aria-hidden />
            <div>
              <h2 id="d5-stuck-title" className="text-[26px] font-normal tracking-[-0.02em]">
                Still stuck? <span className="it text-[var(--sand)]">Take a breath, then tell us.</span>
              </h2>
              <p className="mt-2 max-w-[38rem] text-[16.5px] text-[var(--soft)]">
                Open an issue on GitHub with what you tried and what you saw. Screenshots and the app version help.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <a href={ISSUES_URL} className="btn btn-mint">
                Open an issue
                <ArrowUpRight className="size-4" />
              </a>
              <a href={REPO_URL} className="btn btn-line">
                <GitHubMark className="size-[18px]" />
                Source
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </Shell>
  );
}
