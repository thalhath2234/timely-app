import Link from "next/link";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { ISSUES_URL, RELEASES_URL, REPO_URL } from "@/app/_components/site/links";
import pkg from "@/package.json";
import { Page } from "./ui";

const COLUMNS = [
  {
    title: "Chapters",
    links: [
      { label: "1 · AI", href: "/2#ai" },
      { label: "2 · How it works", href: "/2#how-it-works" },
      { label: "3 · Docs and sheets", href: "/2#docs-and-sheets" },
      { label: "6 · Download", href: "/2#download" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Help center", href: "/2/help" },
      { label: "Install guides", href: "/help/install/windows" },
      { label: "Keyboard shortcuts", href: "/help/start/shortcuts" },
      { label: "Report a problem", href: ISSUES_URL },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Register", href: "/signup" },
      { label: "Log in", href: "/login" },
      { label: "GitHub", href: REPO_URL },
      { label: "Releases", href: RELEASES_URL },
    ],
  },
];

/** Colophon: who set it, in what, and where everything else is. */
export default function Footer() {
  return (
    <footer className="border-t border-[var(--rule-2)] bg-[#100e0b]">
      <Page className="grid gap-12 py-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
        <div>
          <Link href="/2" className="inline-flex min-h-11 items-center gap-2" aria-label="Timely, design 2 home">
            <TimelyLogo size={22} className="text-[var(--ink)]" />
            <span className="d2-serif text-[1.45rem] font-medium">Timely</span>
          </Link>
          <p className="d2-kicker mt-6">Colophon</p>
          <p className="d2-serif mt-2 max-w-[38ch] text-[1.02rem] leading-relaxed text-[var(--ink-2)] italic">
            Set in Newsreader and IBM Plex, with notes in Caveat. Printed on your own computer; bound to nobody&apos;s
            cloud.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="d2-kicker">{column.title}</h2>
              <ul className="mt-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="flex min-h-10 items-center text-[0.95rem] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </Page>
      <Page className="d2-mono flex flex-wrap justify-between gap-2 border-t border-[var(--rule)] py-5 text-[11px] text-[var(--ink-3)]">
        <span>Timely {pkg.version} · open source</span>
        <span>Design 2 · Ink and paper</span>
      </Page>
    </footer>
  );
}
