import Link from "next/link";
import { ISSUES_URL, LATEST_RELEASE_URL, RELEASES_URL, REPO_URL } from "@/app/_components/site/links";
import pkg from "@/package.json";
import { Wordmark } from "./header";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/5#ai", label: "AI" },
      { href: "/5#how-it-works", label: "How it works" },
      { href: "/5#docs-and-sheets", label: "Docs and sheets" },
      { href: "/5#download", label: "Download" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/5/help", label: "Help center" },
      { href: "/help/start/what-is-timely", label: "What is Timely" },
      { href: "/help/start/shortcuts", label: "Keyboard shortcuts" },
      { href: ISSUES_URL, label: "Report an issue" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: REPO_URL, label: "Source on GitHub" },
      { href: RELEASES_URL, label: "Releases" },
      { href: LATEST_RELEASE_URL, label: `Latest: v${pkg.version}` },
      { href: "/signup", label: "Register" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="ftr-grid">
          <div>
            <Link
              href="/5"
              aria-label="Timely, design 5 home"
              className="inline-flex min-h-11 items-center text-[var(--ink)]"
            >
              <Wordmark />
            </Link>
            <p className="mt-3 max-w-xs">
              A private planner. <span className="it text-[1.1em] text-[var(--soft)]">One quiet block at a time.</span>
            </p>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2>{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("http") ? (
                      <a href={link.href}>{link.label}</a>
                    ) : (
                      <Link href={link.href}>{link.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-12 border-t border-[var(--line)] pt-6 text-sm">
          Open source. Runs on your own computer. Windows, Ubuntu, Arch Linux and Android.
        </p>
      </div>
    </footer>
  );
}
