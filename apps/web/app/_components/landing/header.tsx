import Link from "next/link";
import LoopNav from "./loopNav";
import { REPO_URL } from "./sampleData";
import ThemeToggle from "./themeToggle";

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export default function Header() {
  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{ background: "var(--l-canvas)", borderColor: "var(--l-line)" }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Timely home">
          <span className="flex size-8 items-center justify-center rounded-[0.6rem] bg-[#c0c1ff] text-[#1000a9]">
            <span className="l-display text-base font-extrabold select-none">T</span>
          </span>
          <span className="l-display text-xl font-bold">Timely</span>
        </Link>

        <LoopNav />

        <div className="flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          <Link href="/login" className="l-soft rounded-full px-3 py-2 text-sm font-medium hover:text-[var(--l-ink)]">
            Sign In
          </Link>
          <Link href="/signup" className="l-ghost rounded-full px-4 py-2 text-sm font-semibold">
            Register
          </Link>
          <a
            href={REPO_URL}
            className="hidden items-center gap-2 rounded-full bg-[var(--l-ink)] px-4 py-2 text-sm font-semibold text-[var(--l-canvas)] xl:flex"
          >
            <GitHubMark className="size-4" />
            Get the code
          </a>
        </div>
      </div>
    </header>
  );
}
