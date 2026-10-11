import Link from "next/link";
import { REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import pkg from "@/package.json";
import HeroPage from "./heroPage";
import { Page } from "./ui";

/** Title page: what Timely is, the account buttons, and Monday filling in. */
export default function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden border-b border-[var(--rule-2)]">
      <div aria-hidden className="d2-ruled pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />
      <Page className="relative grid items-center gap-x-14 gap-y-14 pt-10 pb-16 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:pt-12 lg:pb-20">
        <div className="min-w-0">
          <p className="d2-kicker flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>The Timely manual</span>
            <span aria-hidden className="h-px w-8 bg-[var(--rule-3)]" />
            <span>Edition {pkg.version}</span>
          </p>
          <h1 id="hero-title" className="d2-display mt-6 text-[3.3rem] sm:text-[5rem] lg:text-[4.9rem] xl:text-[5.5rem]">
            <span className="whitespace-nowrap">Note it down.</span>
            <br />
            <span className="italic">Timely finds</span>
            <br />
            <span className="relative italic">
              the hour
              <span className="text-[var(--verm)] not-italic">.</span>
            </span>
          </h1>
          <p className="d2-soft mt-8 max-w-[34rem] text-lg leading-relaxed sm:text-xl">
            Timely is a private planner. Capture a thought the moment you have it, and Timely places it on your week,
            around your meetings and inside your working hours.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-2.5">
            <Link href="/signup" className="d2-btn d2-btn-verm !min-h-12 !px-6 !text-base">
              Register
            </Link>
            <Link href="/login" className="d2-btn !min-h-12 !px-6 !text-base">
              Log in
            </Link>
            <a href={REPO_URL} className="d2-btn d2-btn-text !min-h-12 !text-base text-[var(--ink-2)] hover:text-[var(--ink)]">
              <GitHubMark className="size-[18px]" />
              GitHub
            </a>
          </div>
          <dl className="mt-12 grid max-w-[36rem] grid-cols-3 border-t border-[var(--rule-2)] text-sm">
            {[
              ["Runs on", "your computer"],
              ["Pairs with", "your phone"],
              ["Source", "open, on GitHub"],
            ].map(([term, detail]) => (
              <div key={term} className="border-r border-[var(--rule)] pt-3 pr-3 last:border-r-0 [&:not(:first-child)]:pl-3">
                <dt className="d2-kicker !text-[0.64rem]">{term}</dt>
                <dd className="d2-serif mt-1 text-[1.05rem] leading-snug italic">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative min-w-0">
          <p aria-hidden className="d2-hand absolute -top-9 left-2 hidden rotate-[-4deg] text-[1.6rem] leading-none text-[var(--verm-2)] lg:-left-24 lg:block">
            watch Monday fill in ↘
          </p>
          <HeroPage />
        </div>
      </Page>
    </section>
  );
}
