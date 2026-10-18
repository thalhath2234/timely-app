import Link from "next/link";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { ISSUES_URL, LATEST_RELEASE_URL, LICENSE_URL, REPO_URL } from "./links";
import { GitHubMark } from "./marks";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#chapters", label: "Features" },
      { href: "/#self-host", label: "Self-host" },
      { href: "/#agents", label: "Agents over MCP" },
      { href: "/#assistant", label: "AI assistant" },
      { href: "/#download", label: "Download" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/help", label: "Help center" },
      { href: "/help/start/what-is-timely", label: "What is Timely?" },
      { href: "/help/install/windows", label: "Install" },
      { href: "/help/install/android#pair", label: "Pair your phone" },
      { href: "/help/assistant/subscriptions", label: "Connect your AI" },
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
      <div className="mx-auto grid max-w-[90rem] gap-10 px-4 py-14 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
        <div>
          <div className="flex items-center gap-2.5">
            <TimelyLogo size={24} />
            <span className="text-lg font-semibold">Timely</span>
          </div>
          <p className="s-soft mt-4 max-w-[36ch] text-sm leading-relaxed">
            A planner with sheets, docs and an assistant, running on your own computer and reaching your phone over Tailscale. Open source.
          </p>
          <a href={REPO_URL} className="s-link mt-5 inline-flex items-center gap-2 text-sm font-medium">
            <GitHubMark className="size-4" />
            thalhath2234/timely-app
          </a>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-sm font-semibold">{column.title}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {column.links.map((link) =>
                  link.href.startsWith("/") ? (
                    <li key={link.href}>
                      <Link href={link.href} className="s-link">
                        {link.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={link.href}>
                      <a href={link.href} className="s-link">
                        {link.label}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-[90rem] px-4 pb-8 sm:px-8">
        <p className="s-faint text-xs">An open-source personal project. Windows, Linux and Android. No cloud, no account with anyone.</p>
      </div>
    </footer>
  );
}
