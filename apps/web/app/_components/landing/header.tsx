import Link from "next/link";
import GitHubMark from "./githubMark";
import LoopNav from "./loopNav";
import { REPO_URL } from "./sampleData";
import ThemeToggle from "./themeToggle";

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
