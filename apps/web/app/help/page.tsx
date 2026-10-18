import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Bot, KeyRound, MonitorDown, Smartphone } from "lucide-react";
import { CHAPTERS } from "@/app/_components/film/chapters";
import HelpSearch from "@/app/_components/help/helpSearch";
import { HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import { Reveal } from "@/app/_components/home/reveal";
import { ScenePlayer } from "@/app/_components/home/scenePlayer";
import { ISSUES_URL, REPO_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, GitHubMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";

export const metadata: Metadata = {
  title: { absolute: "Timely Help" },
};

/** The four things most people come here to do. */
const TASKS = [
  { title: "Install Timely", body: "Windows installer, Linux AppImage or AUR package, Android APK.", href: "#install", icon: MonitorDown, color: "#7cc4ff" },
  { title: "Pair your phone", body: "Scan a QR code on the desktop app, then connect over Tailscale.", href: "/help/install/android#pair", icon: Smartphone, color: "#4edea3" },
  { title: "Connect your AI", body: "Sign in with Claude Code or Codex, or paste an API key.", href: "/help/assistant/subscriptions", icon: KeyRound, color: "#b8b7ff" },
  { title: "Connect an agent", body: "Make a scoped key and point Hermes, OpenClaw or your own agent at Timely's MCP server.", href: "/help/assistant/mcp", icon: Bot, color: "#5cc8ff" },
];

const PLATFORMS = [
  { name: "Windows", detail: "Windows 10 and 11", mark: WindowsMark, href: "/help/install/windows", color: "#7cc4ff" },
  { name: "Ubuntu", detail: "AppImage, also Debian", mark: UbuntuMark, href: "/help/install/ubuntu", color: "#ff9a6b" },
  { name: "Arch Linux", detail: "timely-bin from the AUR", mark: ArchMark, href: "/help/install/arch", color: "#5cc8ff" },
  { name: "Android", detail: "APK that pairs by QR code", mark: AndroidMark, href: "/help/install/android", color: "#4edea3" },
];

/** What changed since v0.3.3, newest first; each row opens the part of an article that explains it. */
const NEW = [
  { title: "Card workshop", body: "Build your own Dashboard card from tasks, events, a sheet or a doc.", href: "/help/notes/dashboard" },
  { title: "Home-screen widgets", body: "Today, Quick add, Pomodoro, Timer and any Dashboard card on Android.", href: "/help/start/widgets" },
  { title: "Today as a day board", body: "Your day, free slots and what is next on one dense screen.", href: "/help/plan/today" },
  { title: "Search in plain words", body: "Type what you want to see, then save it as a view.", href: "/help/notes/search" },
  { title: "Help me write", body: "Drafts and rewrites inside docs and task descriptions.", href: "/help/notes/docs" },
  { title: "Doc lines become tasks", body: "A line that reads like a task is offered once, with a link back.", href: "/help/notes/docs" },
  { title: "Sheets for agents", body: "Formulas, frozen panes on the phone, and MCP tools that write to a tab.", href: "/help/notes/sheets" },
  { title: "Tidier phone screens", body: "Grouped settings, task and project sheets, and the predictive back gesture.", href: "/help/start/phone-app" },
];

/** Three chapters of the film double as short tours here. */
const TOURS = ["cards", "widgets", "assistant"].map((id) => CHAPTERS.find((chapter) => chapter.id === id)!);

export default function HelpHome() {
  return (
    <div className="mx-auto max-w-[90rem] px-4 pb-24 sm:px-8">
      {/* Title row: name, search, and where to start. */}
      <section className="grid gap-8 pt-10 pb-12 sm:pt-14 lg:grid-cols-12 lg:gap-12 lg:pt-16">
        <div className="lg:col-span-5">
          <p className="s-eyebrow">Timely help</p>
          <h1 className="s-display mt-4 text-[2.75rem] sm:text-[4rem]">Help</h1>
          <p className="s-soft mt-4 max-w-[40ch] text-lg leading-relaxed">Install it, pair your phone, plug in your AI, and learn what every part does.</p>
          <div className="relative z-20 mt-7 max-w-xl">
            <HelpSearch entries={SEARCH_INDEX} />
          </div>
        </div>
        <div className="lg:col-span-7">
          <ul className="grid gap-3 sm:grid-cols-2">
            {TASKS.map((task) => (
              <li key={task.title}>
                <Link href={task.href} className="s-card s-card-hover group flex h-full items-start gap-4 p-4 sm:p-5">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px]" style={{ color: task.color, background: `color-mix(in oklch, ${task.color} 12%, transparent)` }}>
                    <task.icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {task.title}
                      <ArrowRight className="size-4 opacity-0 transition-[opacity,translate] group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </span>
                    <span className="s-soft mt-1 block text-sm leading-relaxed">{task.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* What's new: one grouped card of rows, two columns on wide screens. */}
      <section aria-labelledby="new-heading" className="border-t border-[var(--s-line)] py-12">
        <Reveal className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="new-heading" className="s-display text-[1.75rem] sm:text-[2.2rem]">
              New since v0.3.3
            </h2>
            <p className="s-soft mt-2">What changed, and where the help explains it.</p>
          </div>
        </Reveal>
        <ul className="s-card mt-6 grid overflow-hidden p-0 lg:grid-cols-2">
          {NEW.map((item, i) => (
            <li key={item.title} className={`border-[var(--s-line)] ${i > 0 ? "border-t" : ""} ${i === 1 ? "lg:border-t-0" : ""} ${i % 2 === 1 ? "lg:border-l" : ""}`}>
              <Link href={item.href} className="group flex h-full items-center gap-4 px-5 py-4 hover:bg-white/[0.03]">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{item.title}</span>
                  <span className="s-soft block text-sm leading-relaxed">{item.body}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-[var(--s-faint)] transition-[color,translate] group-hover:translate-x-0.5 group-hover:text-[var(--s-primary)]" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Install */}
      <section id="install" aria-labelledby="install-heading" className="scroll-mt-20 border-t border-[var(--s-line)] py-12">
        <Reveal className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="install-heading" className="s-display text-[1.75rem] sm:text-[2.2rem]">
              Install
            </h2>
            <p className="s-soft mt-2">A guide per platform, with the download link in it.</p>
          </div>
          <Link href={articleHref({ id: "install" }, { slug: "updates-and-data" })} className="s-link inline-flex items-center gap-1.5 text-sm font-medium">
            Updates, data and backups
            <ArrowRight className="size-4" />
          </Link>
        </Reveal>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLATFORMS.map((platform) => (
            <li key={platform.name}>
              <Link href={platform.href} className="s-card s-card-hover group flex h-full items-center gap-4 p-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px]" style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 12%, transparent)` }}>
                  <platform.mark className="size-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{platform.name}</span>
                  <span className="s-faint block text-sm">{platform.detail}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-[var(--s-faint)] transition-[color,translate] group-hover:translate-x-0.5 group-hover:text-[var(--s-primary)]" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Tours: three scenes from the landing film, each linked to its article. */}
      <section aria-labelledby="tours-heading" className="border-t border-[var(--s-line)] py-12">
        <Reveal>
          <h2 id="tours-heading" className="s-display text-[1.75rem] sm:text-[2.2rem]">
            Thirty-second tours
          </h2>
          <p className="s-soft mt-2">What it looks like before you read how it works.</p>
        </Reveal>
        <ul className="mt-6 grid gap-5 md:grid-cols-3">
          {TOURS.map((chapter) => (
            <Reveal key={chapter.id} as="li">
              <div className="s-scene">
                <ScenePlayer id={chapter.id} frames={chapter.frames} label={`${chapter.title}: ${chapter.headline}`} />
              </div>
              <Link href={chapter.help} className="group mt-3 flex items-start justify-between gap-3">
                <span>
                  <span className="block font-semibold">{chapter.title}</span>
                  <span className="s-soft block text-sm">{chapter.headline}</span>
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 text-[var(--s-faint)] transition-[color,translate] group-hover:translate-x-0.5 group-hover:text-[var(--s-primary)]" />
              </Link>
            </Reveal>
          ))}
        </ul>
      </section>

      {/* Index of everything. */}
      <section aria-labelledby="index-heading" className="border-t border-[var(--s-line)] py-12">
        <Reveal>
          <h2 id="index-heading" className="s-display text-[1.75rem] sm:text-[2.2rem]">
            Everything, by section
          </h2>
        </Reveal>
        <div className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {HELP_SECTIONS.map((section) => (
            <Reveal key={section.id}>
              <div id={section.id} className="scroll-mt-20 border-t border-[var(--s-line)] pt-4">
                <h3 className="flex items-center gap-2 font-semibold">
                  <section.icon className="size-4 text-[var(--s-primary)]" />
                  {section.title}
                </h3>
                <p className="s-faint mt-1 text-sm leading-relaxed">{section.description}</p>
                <ul className="mt-3 space-y-1">
                  {section.articles.map((article) => (
                    <li key={article.slug}>
                      <Link href={articleHref(section, article)} className="s-link -mx-2 block rounded-[8px] px-2 py-1 text-sm hover:bg-white/[0.04]">
                        {article.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Still stuck */}
      <Reveal className="border-t border-[var(--s-line)] pt-12">
        <div className="s-card flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Found a gap?</h2>
            <p className="s-soft mt-1 text-sm leading-relaxed">
              Timely is open source. Ask a question or report a problem on GitHub, with your platform and version (Settings → Server shows it in the desktop app).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={ISSUES_URL} className="s-btn s-btn-primary">
              Open an issue
              <ArrowUpRight className="size-4" />
            </a>
            <a href={REPO_URL} className="s-btn s-btn-ghost">
              <GitHubMark className="size-4" />
              Source
            </a>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
