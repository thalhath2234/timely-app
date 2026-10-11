import Link from "next/link";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { ISSUES_URL, LATEST_RELEASE_URL, LICENSE_URL, RELEASES_URL } from "@/app/_components/site/links";
import { ACCOUNT, BASE, VERSION } from "./data";

const COLUMNS = [
  {
    title: "Timely",
    links: [
      { label: "AI", href: `${BASE}#ai` },
      { label: "How it works", href: `${BASE}#how-it-works` },
      { label: "Docs and sheets", href: `${BASE}#docs-and-sheets` },
      { label: "Download", href: `${BASE}#download` },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Help center", href: `${BASE}/help` },
      { label: "Keyboard shortcuts", href: "/help/start/shortcuts" },
      { label: "Install guides", href: "/help/install/windows" },
      { label: "Connect an agent", href: "/help/assistant/mcp" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: ACCOUNT.github, external: true },
      { label: "Releases", href: RELEASES_URL, external: true },
      { label: "Report an issue", href: ISSUES_URL, external: true },
      { label: "License", href: LICENSE_URL, external: true },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Register", href: ACCOUNT.register },
      { label: "Log in", href: ACCOUNT.login },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="d3-footer">
      <div className="d3-wrap">
        <div className="d3-footer-grid">
          <div className="d3-footer-brand">
            <Link href={BASE} className="d3-brand">
              <TimelyLogo size={22} />
              <span>Timely</span>
            </Link>
            <p>A private planner for your tasks, calendar, docs and sheets.</p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title} className="d3-footer-col">
              <h2>{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    {"external" in link && link.external ? (
                      <a href={link.href}>{link.label}</a>
                    ) : (
                      <Link href={link.href}>{link.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="d3-footer-line">
          <span>
            <a href={LATEST_RELEASE_URL}>timely v{VERSION}</a>
          </span>
          <span>Windows · Ubuntu · Arch Linux · Android</span>
          <span className="d3-footer-hint">
            press <kbd className="d3-key" data-size="sm">Ctrl</kbd> <kbd className="d3-key" data-size="sm">K</kbd> to jump
          </span>
        </p>
      </div>
    </footer>
  );
}
