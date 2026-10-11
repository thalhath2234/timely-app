import Link from "next/link";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { ISSUES_URL, LATEST_RELEASE_URL, LICENSE_URL, REPO_URL } from "./links";
import { GitHubMark } from "./marks";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#download", label: "Download" },
      { href: "/demo/command-palette", label: "Try the search demo" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/help", label: "Help center" },
      { href: "/help/install/windows", label: "Install on Windows" },
      { href: "/help/install/ubuntu", label: "Install on Ubuntu" },
      { href: "/help/install/arch", label: "Install on Arch" },
      { href: "/help/install/android", label: "Install on Android" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: REPO_URL, label: "Source code" },
      { href: LATEST_RELEASE_URL, label: "Latest release" },
      { href: ISSUES_URL, label: "Report an issue" },
      { href: LICENSE_URL, label: "MIT licence" },
    ],
  },
] as const;

export default function SiteFooter() {
  return (
    <footer className="border-t border-[var(--s-line)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <div className="flex items-center gap-2.5">
            <TimelyLogo size={24} />
            <span className="text-lg font-semibold tracking-[-0.03em]">Timely</span>
          </div>
          <p className="s-soft mt-3 max-w-xs text-sm leading-relaxed">
            A private planner that turns loose thoughts into a planned week. Open source, and it runs on your
            own computer.
          </p>
          <a
            href={REPO_URL}
            className="s-link mt-5 inline-flex items-center gap-2 text-sm font-medium"
          >
            <GitHubMark className="size-4" />
            thalhath2234/timely-app
          </a>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <h2 className="text-sm font-semibold">{column.title}</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {column.links.map((link) => (
                <li key={link.href}>
                  {link.href.startsWith("http") ? (
                    <a href={link.href} className="s-link">
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className="s-link">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="s-faint mx-auto max-w-6xl px-4 pb-10 text-xs sm:px-8">
        An open-source personal project. Windows, Linux and Android.
      </div>
    </footer>
  );
}
