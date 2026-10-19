import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import packageJson from "@/package.json";
import { CHAPTERS } from "@/app/_components/film/chapters";
import ChapterSection from "@/app/_components/home/chapterSection";
import Downloads from "@/app/_components/home/downloads";
import FilmStage from "@/app/_components/home/filmStage";
import { Reveal } from "@/app/_components/home/reveal";
import { LATEST_RELEASE_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { SiteMotion } from "@/app/_components/site/motion";
import { siteFont } from "@/app/_components/site/siteFont";
import SiteFooter from "@/app/_components/site/siteFooter";
import SiteHeader from "@/app/_components/site/siteHeader";
import { cn } from "@/app/utils/cn";
import "@/app/_components/site/site.css";

const TITLE = "Timely: a planner that runs on your machine and thinks with your AI";
const DESCRIPTION =
  "Capture a thought and let the week rearrange itself. Sheets, docs, smart suggestions, an assistant on your own Claude or ChatGPT subscription or API key, an MCP server for your agents, Android widgets. Open source, on your own computer, reaching your phone over Tailscale.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Timely" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const FACTS = [
  {
    title: "Your data stays home",
    body: "The database sits in your app data folder. The server listens on this computer only until you turn on Tailscale access.",
  },
  {
    title: "Your own AI account",
    body: "Claude Code, Codex or an API key, stored encrypted. Without one, everything except the assistant and suggestions still works.",
  },
  {
    title: "Backups built in",
    body: "Encrypted backups on a schedule, a full JSON export, and an automatic copy before every upgrade.",
  },
  {
    title: "Open source",
    body: "MIT licence on GitHub. Issues, pull requests and the roadmap are public, and nothing in the app needs a paid service.",
  },
];

export default function Home() {
  return (
    <div className={cn("site", siteFont.variable)}>
      <SiteMotion>
        <SiteHeader />

        <main id="main-content" className="mx-auto max-w-[90rem] px-4 sm:px-8">
          {/* Hero: the headline, then the film at full width. */}
          <section className="pt-10 pb-10 sm:pt-14 lg:pt-16">
            <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
              <div className="lg:col-span-7">
                <p className="s-eyebrow flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>Open source · Windows, Linux, Android</span>
                  <a href={LATEST_RELEASE_URL} className="s-link inline-flex items-center gap-1 normal-case tracking-normal">
                    <span className="size-1.5 rounded-full bg-[var(--s-green)]" />v{packageJson.version}
                    <ArrowUpRight className="size-3" />
                  </a>
                </p>
                <h1 className="s-display mt-5 text-[2.75rem] sm:text-[4rem] lg:text-[5.2rem]">
                  A planner that runs on <span className="text-[var(--s-primary)]">your</span> machine and thinks with <span className="text-[var(--s-primary)]">your</span> AI.
                </h1>
              </div>
              <div className="lg:col-span-5 lg:pb-2">
                <p className="s-soft max-w-[46ch] text-base leading-relaxed sm:text-lg">
                  Capture a thought, let the week rearrange itself, keep numbers in sheets and notes in docs. The assistant runs on the subscription or key you already have. Your phone reaches it all over Tailscale.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-2.5">
                  <a href={LATEST_RELEASE_URL} className="s-btn s-btn-primary">
                    Download for free
                    <ArrowRight className="size-4" />
                  </a>
                  <a href="#chapters" className="s-btn s-btn-ghost">
                    Eleven chapters
                  </a>
                  <a href={REPO_URL} className="s-btn s-btn-ghost">
                    <GitHubMark className="size-4" />
                    GitHub
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-10 lg:mt-12">
              <FilmStage />
            </div>
          </section>

          {/* The eleven chapters, one section each. */}
          <div id="chapters" className="scroll-mt-20">
            <Reveal className="flex flex-wrap items-end justify-between gap-4 pt-10 pb-6 lg:pt-16">
              <div>
                <p className="s-eyebrow">The film, chapter by chapter</p>
                <h2 className="s-display mt-3 text-[2rem] sm:text-[2.6rem]">Eleven things Timely does.</h2>
              </div>
              <p className="s-soft max-w-[40ch] text-sm leading-relaxed">Every scene above is one of these. Each loops here on its own, next to what it does and what it leaves alone.</p>
            </Reveal>
            {CHAPTERS.map((chapter) => (
              <ChapterSection key={chapter.id} chapter={chapter} />
            ))}
          </div>

          {/* Facts: what self-hosting means in practice. */}
          <section id="facts" className="grid gap-8 border-t border-[var(--s-line)] py-14 lg:grid-cols-12 lg:gap-12 lg:py-20">
            <Reveal className="lg:col-span-4">
              <p className="s-eyebrow">Runs on your machine</p>
              <h2 className="s-display mt-4 text-[2rem] sm:text-[2.6rem]">Nothing leaves your computer unless you say so.</h2>
            </Reveal>
            <Reveal className="lg:col-span-8">
              <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
                {FACTS.map((fact) => (
                  <div key={fact.title} className="border-t border-[var(--s-line)] pt-4">
                    <dt className="font-semibold">{fact.title}</dt>
                    <dd className="s-soft mt-1.5 text-sm leading-relaxed">{fact.body}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </section>

          <Downloads version={packageJson.version} />

          {/* Closing. */}
          <section className="border-t border-[var(--s-line)] py-20 text-center lg:py-28">
            <Reveal>
              <h2 className="s-display mx-auto max-w-[14ch] text-[2.4rem] sm:text-[3.4rem] lg:text-[4rem]">Tomorrow is already planned.</h2>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
                <a href={LATEST_RELEASE_URL} className="s-btn s-btn-primary">
                  Download for free
                  <ArrowRight className="size-4" />
                </a>
                <a href={REPO_URL} className="s-btn s-btn-ghost">
                  <GitHubMark className="size-4" />
                  GitHub
                </a>
              </div>
              <p className="s-soft mt-6 text-sm">
                New here? Start with{" "}
                <Link href="/help/start/what-is-timely" className="text-[var(--s-primary)] underline-offset-4 hover:underline">
                  What is Timely?
                </Link>{" "}
                in the help center.
              </p>
            </Reveal>
          </section>
        </main>

        <SiteFooter />
      </SiteMotion>
    </div>
  );
}
