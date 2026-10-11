"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import packageJson from "@/package.json";
import { TimelyWordmark } from "@/app/_components/_ui/timelyLogo";
import { REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { SiteMotion } from "@/app/_components/site/motion";
import { cn } from "@/app/utils/cn";
import { clock, dateLine, minuteOfDay, useNowMinute } from "./clock";

const ease = [0.22, 1, 0.36, 1] as const;

/**
 * The block the person is in right now, drawn like the landing page's
 * section labels: "10:05–10:10 Sign in".
 */
export function NowBlock({
  label,
  minutes = 5,
  color = "var(--lp-now)",
}: {
  label: ReactNode;
  minutes?: number;
  color?: string;
}) {
  const now = useNowMinute();
  const start = now === null ? null : minuteOfDay(now);
  return (
    <p
      className="lp-block inline-flex items-center gap-2 py-1 pr-2.5 pl-2 text-xs"
      style={{ "--c": color } as CSSProperties}
    >
      <span className="lp-mono inline-block min-w-[5.6rem] text-[var(--lp-soft)]">
        {start === null ? " " : `${clock(start)}–${clock(start + minutes)}`}
      </span>
      <span className="font-semibold text-[var(--lp-ink)]">{label}</span>
    </p>
  );
}

/**
 * Frame for sign-in, sign-up, onboarding and the desktop setup: the landing
 * page's header and date line, the form on the left as the block happening
 * now, and a day view on the right (wide screens only).
 */
export default function AuthShell({
  block,
  title,
  lead,
  aside,
  headerAction,
  children,
  wide = false,
  contentKey,
}: {
  block: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  aside?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  /** A wider form column, for the desktop setup steps. */
  wide?: boolean;
  /** Change it (a step id) to replay the form column's entrance. */
  contentKey?: string;
}) {
  const now = useNowMinute();
  return (
    <SiteMotion>
      <div className="flex min-h-screen flex-col">
        <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
          <Link
            href="/"
            className="flex items-center rounded-lg"
            aria-label="Timely home"
          >
            <TimelyWordmark size={24} textClassName="text-[1.25rem]" />
          </Link>
          <nav aria-label="Account" className="flex items-center gap-1">
            <Link href="/help" className="s-link rounded-lg px-3 py-2 text-sm">
              Help
            </Link>
            {headerAction}
          </nav>
        </header>

        <main
          id="main-content"
          className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-8"
        >
          <div className="mt-3 flex items-center justify-between gap-3 border-b border-[var(--lp-line)] pb-3 sm:mt-6">
            <p className="lp-mono h-4 text-xs tracking-wide text-[var(--lp-soft)] uppercase">
              {now === null ? "" : dateLine(now)}
            </p>
            <p className="lp-mono flex items-center gap-1.5 text-xs text-[var(--lp-soft)]">
              <span className="size-1.5 rounded-full bg-[var(--lp-green)]" />v
              {packageJson.version}
            </p>
          </div>

          <div
            className={cn(
              "grid gap-10 pt-8 pb-16 sm:pt-12 lg:gap-16 lg:pt-14",
              Boolean(aside) &&
                (wide
                  ? "lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]"
                  : "lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]"),
            )}
          >
            <motion.div
              key={contentKey}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
              className="min-w-0"
            >
              {block}
              <h1 className="lp-display mt-5 text-[2.75rem] leading-[0.95] sm:text-[3.5rem]">
                {title}
              </h1>
              {lead ? (
                <p className="mt-4 max-w-[44ch] text-[15px] leading-relaxed sm:text-base text-[var(--lp-soft)]">
                  {lead}
                </p>
              ) : null}
              <div className="mt-8">{children}</div>
            </motion.div>
            {aside ? (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.15, ease }}
                className="hidden min-w-0 lg:block"
              >
                <div className="sticky top-8">{aside}</div>
              </motion.div>
            ) : null}
          </div>
        </main>

        <footer className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--lp-line)] py-5 text-xs text-[var(--lp-soft)]">
            <p>Timely is open source and keeps your data on your own server.</p>
            <div className="flex items-center gap-4">
              <Link href="/help" className="s-link">
                Help center
              </Link>
              <a
                href={REPO_URL}
                className="s-link inline-flex items-center gap-1.5"
              >
                <GitHubMark className="size-3.5" />
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </div>
    </SiteMotion>
  );
}
