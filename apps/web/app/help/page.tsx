import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, MessageCircleQuestion } from "lucide-react";
import HelpSearch from "@/app/_components/help/helpSearch";
import { HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";
import { Reveal, SpotReveal } from "@/app/_components/landing/reveal";
import { ISSUES_URL, REPO_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, GitHubMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";

export const metadata: Metadata = {
  title: { absolute: "Timely Help Center" },
};

const POPULAR = [
  { label: "Use your Claude or ChatGPT plan", href: "/help/assistant/subscriptions" },
  { label: "Install on Windows", href: "/help/install/windows" },
  { label: "Auto-schedule", href: "/help/plan/auto-schedule" },
  { label: "Pair your phone", href: "/help/install/android#pair" },
  { label: "Keyboard shortcuts", href: "/help/start/shortcuts" },
  { label: "Connect an agent", href: "/help/assistant/mcp" },
];

const PLATFORMS = [
  { name: "Windows", detail: "Installer for Windows 10 and 11", mark: WindowsMark, href: "/help/install/windows", color: "#7cc4ff" },
  { name: "Ubuntu", detail: "AppImage for Ubuntu and Debian", mark: UbuntuMark, href: "/help/install/ubuntu", color: "#ff9a6b" },
  { name: "Arch Linux", detail: "timely-bin from the AUR", mark: ArchMark, href: "/help/install/arch", color: "#5cc8ff" },
  { name: "Android", detail: "APK that pairs by QR code", mark: AndroidMark, href: "/help/install/android", color: "#4edea3" },
];

/** Sections shown as topic cards; Install has its own row above. */
const TOPICS = HELP_SECTIONS.filter((section) => section.id !== "install");

export default function HelpHome() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-x-clip">
        <div aria-hidden className="pointer-events-none absolute inset-0 -top-16">
          <div className="s-grid absolute inset-0" />
          <div className="s-orb top-[-20%] left-[18%] size-[380px] bg-[#6f6ff0]" />
          <div className="s-orb top-[0%] right-[12%] size-[320px] bg-[#c26bf0]" style={{ animationDelay: "-7s" }} />
        </div>
        <div className="relative mx-auto max-w-3xl px-4 pt-16 pb-14 text-center sm:px-8 sm:pt-24">
          <Reveal>
            <p className="s-eyebrow mx-auto w-fit rounded-full px-3.5 py-1.5 text-xs font-medium">Timely Help Center</p>
          </Reveal>
          <Reveal delay={0.06}>
            <h1 className="s-display mt-6 text-[2.4rem] leading-[1.05] font-semibold text-balance sm:text-6xl">
              How can we <span className="s-gradient-text">help?</span>
            </h1>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="s-soft mx-auto mt-5 max-w-xl text-lg leading-relaxed">
              Install Timely, set up your first week, and learn everything it can do.
            </p>
          </Reveal>
          <Reveal delay={0.18} className="relative z-20 mx-auto mt-9 max-w-xl text-left">
            <HelpSearch entries={SEARCH_INDEX} />
          </Reveal>
          <Reveal delay={0.24}>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
              <span className="s-faint">Popular:</span>
              {POPULAR.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[var(--s-soft)] transition-colors hover:border-white/20 hover:text-[var(--s-ink)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
        {/* Get started */}
        <SpotReveal className="rounded-[26px]">
          <div className="s-spot-inner grid items-center gap-8 overflow-hidden rounded-[25px] border border-white/[0.06] p-6 sm:p-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:p-10">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[var(--s-primary)] uppercase">New to Timely?</p>
              <h2 className="s-display mt-3 text-3xl font-semibold sm:text-4xl">Start with the loop.</h2>
              <p className="s-soft mt-4 leading-relaxed">
                Capture a thought, clarify it, and let Auto-schedule place it on your week. Two short articles get you
                from installing to a planned week.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href="/help/start/what-is-timely"
                  className="s-btn-primary inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold"
                >
                  What is Timely?
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/help/start/first-week"
                  className="s-btn-ghost inline-flex h-11 items-center rounded-full px-5 text-sm font-semibold"
                >
                  Set up your first week
                </Link>
              </div>
            </div>
            <div className="relative">
              <div aria-hidden className="s-orb top-[10%] left-[20%] size-[260px] bg-[#6f6ff0] opacity-40" />
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#111319] p-1 shadow-[0_30px_80px_-30px_rgba(129,131,244,0.55)] transition-transform duration-500 lg:[transform:perspective(1400px)_rotateY(-8deg)_rotateX(3deg)] lg:hover:[transform:perspective(1400px)_rotateY(0deg)_rotateX(0deg)]">
                <Image
                  src="/help/calendar.webp"
                  alt="Timely's week calendar with work blocks placed around events."
                  width={1920}
                  height={1200}
                  sizes="(min-width: 1024px) 600px, 100vw"
                  priority
                  className="block h-auto w-full rounded-[13px]"
                />
              </div>
            </div>
          </div>
        </SpotReveal>

        {/* Install */}
        <section id="install" aria-labelledby="install-heading" className="mt-20">
          <Reveal className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="install-heading" className="s-display text-2xl font-semibold sm:text-3xl">
                Install Timely
              </h2>
              <p className="s-soft mt-2">Step-by-step guides with download links for each platform.</p>
            </div>
            <Link href={articleHref({ id: "install" }, { slug: "updates-and-data" })} className="s-link text-sm font-medium">
              Updates, data and backups →
            </Link>
          </Reveal>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PLATFORMS.map((platform, index) => (
              <Reveal key={platform.name} delay={index * 0.06}>
                <Link
                  href={platform.href}
                  className="group s-card flex h-full items-center gap-4 rounded-2xl p-4 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-white/20"
                >
                  <span
                    className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/10"
                    style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 12%, transparent)` }}
                  >
                    <platform.mark className="size-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{platform.name}</span>
                    <span className="s-faint block text-sm">{platform.detail}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-white/30 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-[var(--s-primary)]" />
                </Link>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Topics */}
        <section aria-labelledby="topics-heading" className="mt-20">
          <Reveal>
            <h2 id="topics-heading" className="s-display text-2xl font-semibold sm:text-3xl">
              Browse by topic
            </h2>
            <p className="s-soft mt-2">Everything Timely can do, one feature at a time.</p>
          </Reveal>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {TOPICS.map((section, index) => (
              <SpotReveal key={section.id} delay={(index % 3) * 0.06} className="rounded-[22px]">
                <div id={section.id} className="s-spot-inner flex h-full flex-col rounded-[21px] border border-white/[0.06] p-5 sm:p-6">
                  <span className="flex size-10 items-center justify-center rounded-xl border border-[#c0c1ff]/25 bg-[#c0c1ff]/10 text-[var(--s-primary)]">
                    <section.icon className="size-5" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">{section.title}</h3>
                  <p className="s-soft mt-1.5 text-sm leading-relaxed">{section.description}</p>
                  <ul className="mt-4 space-y-0.5 border-t border-white/[0.06] pt-3">
                    {section.articles.map((article) => (
                      <li key={article.slug}>
                        <Link
                          href={articleHref(section, article)}
                          className="group -mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--s-soft)] transition-colors hover:bg-white/[0.04] hover:text-[var(--s-ink)]"
                        >
                          {article.title}
                          <ArrowRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </SpotReveal>
            ))}
          </div>
        </section>

        {/* Still stuck */}
        <Reveal className="mt-20">
          <div className="s-card flex flex-col items-start gap-5 rounded-2xl p-6 sm:flex-row sm:items-center sm:p-8">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#c0c1ff]/10 text-[var(--s-primary)]">
              <MessageCircleQuestion className="size-6" />
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Didn&apos;t find what you need?</h2>
              <p className="s-soft mt-1 text-sm leading-relaxed">
                Timely is open source. Ask a question or report a problem on GitHub, and include your platform and
                version (Settings → Server shows it in the desktop app).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={ISSUES_URL} className="s-btn-primary inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold">
                Open an issue
                <ArrowUpRight className="size-4" />
              </a>
              <a href={REPO_URL} className="s-btn-ghost inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold">
                <GitHubMark className="size-4" />
                Source
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </>
  );
}
