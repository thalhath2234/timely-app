import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Database, HardDrive, Lock, QrCode, Server, Smartphone } from "lucide-react";
import { RELEASES_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, GitHubMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import AiPanes from "./ai";
import CopyButton from "./copyButton";
import { ACCOUNT, PLATFORMS, VERSION, type PlatformId } from "./data";
import DocsSheetsWindow from "./docsSheets";
import { Keys } from "./kbd";
import Keymap from "./keymap";
import LoopStory from "./loop";
import { Reveal } from "./motion";

/** Section opener: a numbered command line on the left, the heading and lede on the right. */
function SectionHead({
  index,
  command,
  keys,
  keysLabel,
  id,
  title,
  children,
}: {
  index: string;
  command: string;
  keys?: string[];
  keysLabel?: string;
  id: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Reveal className="d3-sec-head">
      <div className="d3-sec-meta">
        <p className="d3-sec-index">
          <span>{index}</span>
          <span className="d3-prompt" aria-hidden>
            ›
          </span>{" "}
          {command}
        </p>
        {keys ? <Keys keys={keys} label={keysLabel} /> : null}
      </div>
      <div>
        <h2 id={id} className="d3-h2">
          {title}
        </h2>
        {children ? <div className="d3-sec-lede">{children}</div> : null}
      </div>
    </Reveal>
  );
}

export function AiSection() {
  return (
    <section id="ai" className="d3-sec" aria-labelledby="ai-title">
      <div className="d3-wrap">
        <SectionHead index="01" command="ai" keys={["Ctrl", "Shift", "J"]} keysLabel="Control Shift J" id="ai-title" title="Bring the AI you already pay for.">
          <p>
            Timely&apos;s assistant runs on the Claude or ChatGPT subscription you already have. It plans with you,
            fills in the details while you clarify, and lets your own agents in through MCP. Press{" "}
            <b>Ctrl Shift J</b> to ask it from a quick prompt, wherever you are.
          </p>
        </SectionHead>
        <Reveal>
          <AiPanes />
        </Reveal>
      </div>
    </section>
  );
}

export function LoopSection() {
  return (
    <section id="how-it-works" className="d3-sec d3-sec-alt" aria-labelledby="how-title">
      <div className="d3-wrap">
        <SectionHead index="02" command="how-it-works" id="how-title" title="Capture, clarify, schedule, focus.">
          <p>
            One loop, four keystrokes deep. Get a thought down in a second, decide what it is later, let Auto-schedule
            find it a slot, then work on one thing at a time.
          </p>
        </SectionHead>
        <LoopStory />
      </div>
    </section>
  );
}

const DOC_FEATURES = [
  ["Markdown", "Type Markdown, get blocks. Export a doc to .md that reads well in GitHub and Obsidian."],
  ["/", "The slash menu: headings, to-dos, tables, diagrams, maths and callouts."],
  ["@", "Mention a doc, sheet, task or project."],
  ["Mermaid", "Diagrams written as text, drawn in the doc."],
];

const SHEET_FEATURES = [
  ["Typed columns", "Text, numbers, dates, dropdowns and checkboxes."],
  ["=SUM()", "Formulas, plus a fill handle to drag them down."],
  ["Tabs", "Several tabs in one sheet; each exports to CSV."],
  ["Receipts", "Snap a receipt and the assistant adds the row."],
];

function ManList({ title, items }: { title: string; items: string[][] }) {
  return (
    <div className="d3-man">
      <h3 className="d3-man-title">{title}</h3>
      <dl>
        {items.map(([term, text]) => (
          <div key={term} className="d3-man-row">
            <dt>{term}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function DocsSheetsSection() {
  return (
    <section id="docs-and-sheets" className="d3-sec" aria-labelledby="docs-title">
      <div className="d3-wrap">
        <SectionHead index="03" command="docs-and-sheets" keys={["/"]} keysLabel="slash" id="docs-title" title="Docs and sheets, next to the work.">
          <p>
            A block editor that speaks Markdown and a spreadsheet with real formulas, both inside your projects and
            both in search. The assistant can write the doc and add the rows.
          </p>
        </SectionHead>
        <Reveal>
          <DocsSheetsWindow />
        </Reveal>
        <Reveal className="d3-man-grid">
          <ManList title="Docs" items={DOC_FEATURES} />
          <ManList title="Sheets" items={SHEET_FEATURES} />
        </Reveal>
      </div>
    </section>
  );
}

export function FeaturesSection() {
  return (
    <section className="d3-sec d3-sec-alt" aria-labelledby="more-title">
      <div className="d3-wrap">
        <SectionHead index="04" command="keymap" keys={["g"]} keysLabel="g" id="more-title" title="The rest of it, a keystroke away.">
          <p>
            Press <b>g</b> and a letter to go anywhere. These are real screens from the desktop app.
          </p>
        </SectionHead>
        <Reveal>
          <Keymap />
        </Reveal>
      </div>
    </section>
  );
}

const PRIVATE_POINTS: { icon: typeof Lock; title: string; text: ReactNode }[] = [
  {
    icon: HardDrive,
    title: "Server included",
    text: (
      <>
        The desktop app bundles its own server and PostgreSQL database. Your data lives in{" "}
        <code>%APPDATA%\Timely</code> or <code>~/.config/Timely</code>.
      </>
    ),
  },
  {
    icon: QrCode,
    title: "Phone over your own network",
    text: <>The Android app pairs by QR code and reaches your computer over your own Tailscale network.</>,
  },
  {
    icon: Lock,
    title: "Encrypted backups",
    text: <>Scheduled backups are encrypted and kept on your server. Keep up to 30, restore any of them.</>,
  },
  {
    icon: BookOpen,
    title: "Open source",
    text: <>Every line is on GitHub. Read it, build it, file an issue.</>,
  },
];

export function PrivateSection() {
  return (
    <section className="d3-sec" aria-labelledby="private-title">
      <div className="d3-wrap">
        <SectionHead index="05" command="private" id="private-title" title="Runs on your computer. Answers to you.">
          <p>No Timely cloud between you and your week. The app, the server and the database are on your machine.</p>
        </SectionHead>
        <div className="d3-private">
          <Reveal className="d3-topo">
            <div className="d3-topo-box">
              <p className="d3-topo-label">your computer</p>
              <div className="d3-topo-stack">
                <span>
                  <HardDrive aria-hidden className="d3-ico-sm" /> Timely desktop app
                </span>
                <span className="d3-topo-wire" aria-hidden />
                <span>
                  <Server aria-hidden className="d3-ico-sm" /> server
                </span>
                <span className="d3-topo-wire" aria-hidden />
                <span>
                  <Database aria-hidden className="d3-ico-sm" /> PostgreSQL
                </span>
              </div>
              <p className="d3-topo-foot">
                <Lock aria-hidden className="d3-ico-sm" /> encrypted backups
              </p>
            </div>
            <div className="d3-topo-link" aria-hidden>
              <span className="d3-topo-line">
                <i />
                <i />
                <i />
              </span>
              <span className="d3-topo-net">your tailnet</span>
            </div>
            <div className="d3-topo-box d3-topo-phone">
              <p className="d3-topo-label">your phone</p>
              <div className="d3-topo-stack">
                <span>
                  <Smartphone aria-hidden className="d3-ico-sm" /> Timely for Android
                </span>
              </div>
              <p className="d3-topo-foot">
                <QrCode aria-hidden className="d3-ico-sm" /> paired by QR code
              </p>
            </div>
          </Reveal>
          <ul className="d3-points">
            {PRIVATE_POINTS.map((point, index) => (
              <li key={point.title}>
                <Reveal delay={index * 0.05}>
                  <h3 className="d3-point-title">
                    <point.icon aria-hidden className="d3-ico-sm" />
                    {point.title}
                  </h3>
                  <p className="d3-point-text">{point.text}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const MARKS: Record<PlatformId, typeof WindowsMark> = {
  windows: WindowsMark,
  ubuntu: UbuntuMark,
  arch: ArchMark,
  android: AndroidMark,
};

export function DownloadSection() {
  return (
    <section id="download" className="d3-sec d3-sec-alt" aria-labelledby="download-title">
      <div className="d3-wrap">
        <SectionHead index="06" command="download" id="download-title" title="Install it where you work.">
          <p>
            Version <b>{VERSION}</b> for Windows, Ubuntu, Arch Linux and Android. The phone app pairs with the desktop
            app, so start on your computer.
          </p>
        </SectionHead>
        <div className="d3-dl">
          <p className="d3-dl-head" aria-hidden>
            <span>platform</span>
            <span>package</span>
            <span />
          </p>
          {PLATFORMS.map((platform, index) => {
            const Mark = MARKS[platform.id];
            return (
              <Reveal key={platform.id} delay={index * 0.06} className="d3-dl-row">
                <h3 className="d3-dl-name">
                  <Mark className="d3-dl-mark" />
                  {platform.name}
                </h3>
                <div className="d3-dl-file">
                  <p className="d3-dl-filename">{platform.file}</p>
                  <p className="d3-dl-note">{platform.note}</p>
                  {platform.command ? (
                    <p className="d3-dl-cmd">
                      <span className="d3-prompt" aria-hidden>
                        $
                      </span>
                      <code>{platform.command}</code>
                      <CopyButton text={platform.command} />
                    </p>
                  ) : null}
                </div>
                <div className="d3-dl-actions">
                  <a href={platform.download.href} className="d3-btn d3-btn-amber d3-btn-sm">
                    {platform.download.label}
                    <ArrowUpRight aria-hidden />
                  </a>
                  <Link href={platform.guide} className="d3-btn d3-btn-ghost d3-btn-sm">
                    Install guide
                  </Link>
                </div>
              </Reveal>
            );
          })}
          <p className="d3-dl-foot">
            Older versions and checksums are on the{" "}
            <a href={RELEASES_URL} className="d3-link">
              releases page
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

export function ClosingSection() {
  return (
    <section className="d3-close" aria-labelledby="close-title">
      <div className="d3-wrap d3-close-inner">
        <Reveal>
          <p className="d3-close-prompt" aria-hidden>
            <span className="d3-prompt">›</span> plan next week<span className="d3-caret" />
          </p>
          <h2 id="close-title" className="d3-h2 d3-close-title">
            Your week, one keystroke away.
          </h2>
          <p className="d3-sec-lede">Register to start planning, or log in and pick up where you left off.</p>
          <div className="d3-cta">
            <Link href={ACCOUNT.register} className="d3-btn d3-btn-amber">
              Register
            </Link>
            <Link href={ACCOUNT.login} className="d3-btn d3-btn-ghost">
              Log in
            </Link>
            <a href={ACCOUNT.github} className="d3-btn d3-btn-plain">
              <GitHubMark />
              Star on GitHub
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
