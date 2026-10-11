import Link from "next/link";
import packageJson from "@/package.json";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { ISSUES_URL, LATEST_RELEASE_URL, REPO_URL } from "@/app/_components/site/links";
import { BASE, WEEK } from "./data";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: `${BASE}#ai`, label: "AI" },
      { href: `${BASE}#how-it-works`, label: "How it works" },
      { href: `${BASE}#docs-and-sheets`, label: "Docs and sheets" },
      { href: `${BASE}#download`, label: "Download" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: `${BASE}/help`, label: "Help center" },
      { href: "/help/start/first-week", label: "Your first week" },
      { href: "/help/start/shortcuts", label: "Keyboard shortcuts" },
      { href: ISSUES_URL, label: "Report an issue" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/signup", label: "Register" },
      { href: "/login", label: "Log in" },
    ],
  },
  {
    title: "Code",
    links: [
      { href: REPO_URL, label: "GitHub" },
      { href: LATEST_RELEASE_URL, label: `Release ${packageJson.version}` },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative mt-0 border-t border-[var(--line-2)]">
      <div className="d4-wrap">
        <div className="d4-cols gap-y-10 py-12 md:py-16">
          <div className="col-span-4 md:col-span-4">
            <Link href={BASE} className="inline-flex min-h-10 items-center gap-2" aria-label="Timely home">
              <TimelyLogo size={22} className="[&_.fill-primary]:fill-[var(--amber)]" />
              <span className="text-xl font-bold tracking-[-0.045em]">Timely</span>
            </Link>
            <p className="d4-body mt-3 max-w-[30ch]">
              A private planner for your own computer and phone. Open source.
            </p>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title} className="col-span-2 md:col-span-2">
              <h2 className="d4-label d4-faint">{column.title}</h2>
              <ul className="mt-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="inline-flex min-h-10 items-center text-[15px] text-[var(--soft)] hover:text-[var(--ink)]">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[var(--line)] py-5 text-[13px] text-[var(--faint)]">
          <p className="d4-mono">
            timely {packageJson.version} · W{WEEK.number} · {WEEK.label}
          </p>
          <p>Design 4 · Swiss kinetic week</p>
        </div>
      </div>
    </footer>
  );
}
