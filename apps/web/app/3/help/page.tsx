import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CornerDownLeft } from "lucide-react";
import { HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import { ISSUES_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, GitHubMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import { PLATFORMS, type PlatformId } from "../_parts/data";
import { fontVars } from "../_parts/fonts";
import Footer from "../_parts/footer";
import Header from "../_parts/header";
import HelpPalette from "../_parts/helpPalette";
import { D3Motion, Reveal } from "../_parts/motion";
import TopicKeys from "../_parts/topicKeys";
import "../_parts/design.css";

export const metadata: Metadata = {
  title: { absolute: "Timely Help Center · Design 3" },
  description: "Install Timely, plan your first week, and learn every part of it.",
};

const POPULAR = [
  { title: "Use your Claude or ChatGPT plan", href: "/help/assistant/subscriptions", section: "Assistant and AI", summary: "Connect Claude Code or Codex" },
  { title: "Auto-schedule", href: "/help/plan/auto-schedule", section: "Plan your time", summary: "How Timely places Work on your calendar" },
  { title: "Pair your phone", href: "/help/install/android#pair", section: "Install", summary: "QR code pairing with the desktop app" },
  { title: "Keyboard shortcuts", href: "/help/start/shortcuts", section: "Getting started", summary: "Every shortcut in the app" },
  { title: "Connect an agent with MCP", href: "/help/assistant/mcp", section: "Assistant and AI", summary: "A personal key for your own agents" },
  { title: "Set up your first week", href: "/help/start/first-week", section: "Getting started", summary: "From install to a planned week" },
];

const CHEATS = [
  { keys: ["Ctrl", "K"], spoken: "Control K", label: "Search and commands" },
  { keys: ["Ctrl", "Shift", "J"], spoken: "Control Shift J", label: "Ask the assistant" },
  { keys: ["c"], spoken: "c", label: "New task" },
  { keys: ["g", "i"], spoken: "g then i", label: "Inbox" },
  { keys: ["g", "c"], spoken: "g then c", label: "Calendar" },
  { keys: ["g", "y"], spoken: "g then y", label: "Today" },
  { keys: ["x"], spoken: "x", label: "Complete open task" },
  { keys: ["s"], spoken: "s", label: "Schedule open task" },
];

const MARKS: Record<PlatformId, typeof WindowsMark> = {
  windows: WindowsMark,
  ubuntu: UbuntuMark,
  arch: ArchMark,
  android: AndroidMark,
};

/** Design iteration 3: the help center home as a command menu. Articles stay at /help/<section>/<article>. */
export default function DesignThreeHelp() {
  return (
    <div className={`d3 ${fontVars}`}>
      <D3Motion>
        <Header />
        <main id="main-content">
          <section className="d3-help-hero" aria-labelledby="help-title">
            <div className="d3-wrap d3-help-hero-grid">
              <div className="d3-help-hero-main">
              <p className="d3-sec-index">
                <span>?</span>
                <span className="d3-prompt" aria-hidden>
                  ›
                </span>{" "}
                timely help
              </p>
              <h1 id="help-title" className="d3-h1 d3-help-h1">
                What do you need to do?
              </h1>
              <p className="d3-lede">
                Install Timely, set up your first week, and learn the rest. Type below, or press{" "}
                <kbd className="d3-key" data-size="sm">/</kbd> from anywhere on this page.
              </p>
              <div className="d3-help-search">
                <HelpPalette entries={SEARCH_INDEX} popular={POPULAR} />
              </div>
              </div>
              <aside className="d3-cheat" aria-labelledby="cheat-title">
                <h2 id="cheat-title" className="d3-cheat-title">
                  Shortcuts in the app
                </h2>
                <dl>
                  {CHEATS.map((cheat) => (
                    <div key={cheat.label} className="d3-cheat-row">
                      <dt aria-label={cheat.spoken}>
                        {cheat.keys.map((key, index) => (
                          <kbd key={`${key}-${index}`} className="d3-key" data-size="sm">
                            {key}
                          </kbd>
                        ))}
                      </dt>
                      <dd>{cheat.label}</dd>
                    </div>
                  ))}
                </dl>
                <Link href="/help/start/shortcuts" className="d3-link d3-cheat-more">
                  Every shortcut
                </Link>
              </aside>
            </div>
          </section>

          <section className="d3-help-install" aria-labelledby="install-title">
            <div className="d3-wrap">
              <div className="d3-help-row-head">
                <h2 id="install-title" className="d3-help-h2">
                  Install
                </h2>
                <Link href={articleHref({ id: "install" }, { slug: "updates-and-data" })} className="d3-link">
                  Updates, data and backups
                </Link>
              </div>
              <ul className="d3-help-platforms">
                {PLATFORMS.map((platform, index) => {
                  const Mark = MARKS[platform.id];
                  return (
                    <li key={platform.id}>
                      <Reveal delay={index * 0.05}>
                        <Link href={platform.guide} className="d3-help-platform">
                          <span className="d3-help-platform-top">
                            <Mark className="d3-dl-mark" />
                            <span className="d3-help-platform-name">{platform.name}</span>
                            <CornerDownLeft aria-hidden className="d3-ico-sm d3-help-go" />
                          </span>
                          <span className="d3-help-platform-file">{platform.command ?? platform.file}</span>
                          <span className="d3-help-platform-note">{platform.note}</span>
                        </Link>
                      </Reveal>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          <section className="d3-help-topics" aria-labelledby="topics-title">
            <div className="d3-wrap d3-help-topics-grid">
              <aside className="d3-help-index">
                <h2 id="topics-title" className="d3-help-h2">
                  Topics
                </h2>
                <p className="d3-help-index-hint">
                  Press a number to jump. <kbd className="d3-key" data-size="sm">1</kbd>–
                  <kbd className="d3-key" data-size="sm">{HELP_SECTIONS.length}</kbd>
                </p>
                <ol className="d3-help-index-list">
                  {HELP_SECTIONS.map((section, index) => (
                    <li key={section.id}>
                      <a href={`#topic-${section.id}`}>
                        <kbd className="d3-key" data-size="sm">
                          {index + 1}
                        </kbd>
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </aside>

              <div className="d3-help-groups">
                {HELP_SECTIONS.map((section, index) => (
                  <section key={section.id} id={`topic-${section.id}`} className="d3-help-group" aria-labelledby={`topic-${section.id}-title`}>
                    <Reveal>
                      <div className="d3-help-group-head">
                        <kbd className="d3-key" aria-hidden>
                          {index + 1}
                        </kbd>
                        <section.icon aria-hidden className="d3-help-group-ico" />
                        <div>
                          <h3 id={`topic-${section.id}-title`} className="d3-help-group-title">
                            {section.title}
                          </h3>
                          <p className="d3-help-group-desc">{section.description}</p>
                        </div>
                      </div>
                      <ul className="d3-help-articles">
                        {section.articles.map((article) => (
                          <li key={article.slug}>
                            <Link href={articleHref(section, article)} className="d3-help-article">
                              <span className="d3-help-article-cmd">
                                /{section.id}/{article.slug}
                              </span>
                              <span className="d3-help-article-title">{article.title}</span>
                              <span className="d3-help-article-sum">{article.summary}</span>
                              <CornerDownLeft aria-hidden className="d3-ico-sm d3-help-go" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </Reveal>
                  </section>
                ))}
              </div>
            </div>
            <TopicKeys ids={HELP_SECTIONS.map((section) => section.id)} />
          </section>

          <section className="d3-help-stuck" aria-labelledby="stuck-title">
            <div className="d3-wrap">
              <Reveal className="d3-stuck">
                <div className="d3-stuck-term" aria-hidden>
                  <p>
                    <span className="d3-term-amber">›</span> search the help center
                  </p>
                  <p className="d3-term-dim">0 results</p>
                  <p>
                    <span className="d3-term-amber">›</span> ask a person<span className="d3-caret d3-caret-sm" />
                  </p>
                </div>
                <div>
                  <h2 id="stuck-title" className="d3-help-h2">
                    Still stuck?
                  </h2>
                  <p className="d3-stuck-text">
                    Open an issue on GitHub. Say what you tried, which platform you are on and which version of Timely
                    you have, and we&apos;ll take it from there.
                  </p>
                  <div className="d3-cta">
                    <a href={ISSUES_URL} className="d3-btn d3-btn-amber">
                      <GitHubMark />
                      Open an issue
                      <ArrowUpRight aria-hidden />
                    </a>
                    <Link href="/help/start/shortcuts" className="d3-btn d3-btn-ghost">
                      Keyboard shortcuts
                    </Link>
                  </div>
                </div>
              </Reveal>
            </div>
          </section>
        </main>
        <Footer />
      </D3Motion>
    </div>
  );
}
