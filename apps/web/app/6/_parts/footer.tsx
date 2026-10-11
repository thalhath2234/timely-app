import Link from "next/link";
import { TimelyWordmark } from "@/app/_components/_ui/timelyLogo";
import { ISSUES_URL, LICENSE_URL, RELEASES_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import pkg from "@/package.json";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "AI assistant", href: "/6#ai" },
      { label: "How it works", href: "/6#how-it-works" },
      { label: "Docs and sheets", href: "/6#docs-and-sheets" },
      { label: "Download", href: "/6#download" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Help center", href: "/6/help" },
      { label: "What is Timely?", href: "/help/start/what-is-timely" },
      { label: "Keyboard shortcuts", href: "/help/start/shortcuts" },
      { label: "Connect an agent", href: "/help/assistant/mcp" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source on GitHub", href: REPO_URL },
      { label: "Releases", href: RELEASES_URL },
      { label: "Report an issue", href: ISSUES_URL },
      { label: "Licence", href: LICENSE_URL },
    ],
  },
];

export default function DeskFooter() {
  return (
    <footer className="border-t border-[var(--line)] bg-[#141311]">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.3fr_repeat(3,1fr)]">
        <div>
          <Link href="/6" className="inline-flex h-11 items-center rounded-lg" aria-label="Timely, design 6 home">
            <TimelyWordmark size={24} textClassName="d6-display text-[1.35rem] font-extrabold text-[var(--ink)]" />
          </Link>
          <p className="d6-soft mt-3 max-w-xs text-[0.95rem] leading-relaxed">
            A private planner for Windows, Linux and Android. Open source, version {pkg.version}.
          </p>
          <a
            href={REPO_URL}
            className="d6-btn d6-btn-line mt-5 !min-h-10 !text-[0.9rem]"
          >
            <GitHubMark className="size-4" />
            Star on GitHub
          </a>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="d6-display text-[0.95rem] font-bold text-[var(--ink)]">{column.title}</h2>
            <ul className="mt-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="flex min-h-10 items-center text-[0.95rem] text-[var(--soft)] transition-colors hover:text-[var(--ink)]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <p className="d6-faint mx-auto max-w-[1240px] px-4 pb-10 text-sm sm:px-6">
        Design 6 · Sticky-note desk. Times on this page are examples from a week in October 2026.
      </p>
    </footer>
  );
}
