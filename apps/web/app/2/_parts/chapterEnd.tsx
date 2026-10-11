import Link from "next/link";
import { AUR_URL, LATEST_RELEASE_URL, REPO_URL, TAILSCALE_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, GitHubMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import pkg from "@/package.json";
import ClosingStamp from "./closingStamp";
import PrivacyFigure from "./privacyFigure";
import { ChapterHead, Fn, Footnotes, Page, Rv } from "./ui";

const v = pkg.version;

const POINTS = [
  {
    n: 1,
    title: "Your data stays home",
    body: "The desktop app brings its own server and PostgreSQL database. The server listens on this computer only unless you turn on Tailscale access.",
  },
  {
    n: 2,
    title: "Your phone, on your network",
    body: "The Android app pairs with your computer by QR code and connects over your own Tailscale network.",
  },
  {
    n: 3,
    title: "Backups built in",
    body: "Encrypted account backups on a schedule, a full export, and an automatic copy before every upgrade.",
  },
  {
    n: 4,
    title: "Open source",
    body: "Every line is on GitHub. Read it, report a problem, or follow the releases.",
  },
];

/** Chapter 5: where your data lives. */
export function ChapterPrivate() {
  return (
    <section aria-labelledby="private-title" className="border-t border-[var(--rule-2)] py-20 sm:py-28">
      <Page>
        <ChapterHead
          n={5}
          head="Kept at home"
          headingId="private-title"
          title="Runs on your computer. Reaches your phone."
          lead={
            <>
              Nothing goes to someone else&apos;s cloud. The assistant uses your own sign-in or key, stored encrypted
              <Fn n={4} />.
            </>
          }
        />
        <Rv className="mt-14">
          <PrivacyFigure />
        </Rv>
        <ol className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:ml-[220px] lg:grid-cols-4">
          {POINTS.map((point, index) => (
            <Rv as="li" key={point.n} delay={index * 70} className="border-t border-[var(--rule-3)] pt-4">
              <p className="flex items-start gap-2.5">
                <span className="d2-mono mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--verm)] text-[11px] text-[var(--verm-2)]">
                  {point.n}
                </span>
                <span className="d2-serif text-[1.2rem]">{point.title}</span>
              </p>
              <p className="d2-soft mt-2 text-[0.95rem] leading-relaxed">{point.body}</p>
            </Rv>
          ))}
        </ol>
        <Footnotes
          running="Kept at home"
          folio={28}
          notes={[
            {
              n: 4,
              text: (
                <>
                  Without an AI sign-in or key, everything else still works. For the phone you need{" "}
                  <a href={TAILSCALE_URL} className="d2-link">
                    Tailscale
                  </a>{" "}
                  on both devices.
                </>
              ),
            },
          ]}
        />
      </Page>
    </section>
  );
}

const PLATFORMS = [
  {
    name: "Windows",
    Mark: WindowsMark,
    file: `Timely-${v}-win-x64.exe`,
    note: "Per-user installer. Updates itself.",
    href: LATEST_RELEASE_URL,
    action: "Download .exe",
    guide: "/help/install/windows",
  },
  {
    name: "Ubuntu",
    Mark: UbuntuMark,
    file: `Timely-${v}-linux-x86_64.AppImage`,
    note: "One file. Needs libfuse2. Updates itself.",
    href: LATEST_RELEASE_URL,
    action: "Download AppImage",
    guide: "/help/install/ubuntu",
  },
  {
    name: "Arch Linux",
    Mark: ArchMark,
    file: "timely-bin",
    note: "From the AUR, updated with pacman.",
    href: AUR_URL,
    action: "Open on the AUR",
    guide: "/help/install/arch",
  },
  {
    name: "Android",
    Mark: AndroidMark,
    file: `Timely-${v}-android-arm64.apk`,
    note: "Pairs with your computer by QR code.",
    href: LATEST_RELEASE_URL,
    action: "Download .apk",
    guide: "/help/install/android",
  },
];

/** Chapter 6: the downloads, as a printed timetable. */
export function ChapterDownload() {
  return (
    <section id="download" aria-labelledby="download-title" className="border-t border-[var(--rule-2)] bg-[var(--paper-2)] py-20 sm:py-28">
      <Page>
        <ChapterHead
          n={6}
          head="Download"
          headingId="download-title"
          title="Set it up before the end of the day."
          lead={`Release ${v}. Install the desktop app on Windows or Linux, then pair the Android app with it.`}
        />
        <div className="mt-12 lg:ml-[220px]">
          <div className="d2-mono hidden grid-cols-[200px_minmax(0,1fr)_auto] gap-6 border-b border-[var(--rule-3)] pb-2 text-[10px] tracking-widest text-[var(--ink-3)] uppercase md:grid">
            <span>Platform</span>
            <span>File</span>
            <span className="pr-1">Get it</span>
          </div>
          <ul>
            {PLATFORMS.map((platform, index) => (
              <Rv
                as="li"
                key={platform.name}
                delay={index * 60}
                className="grid items-center gap-x-6 gap-y-3 border-b border-[var(--rule-2)] py-5 md:grid-cols-[200px_minmax(0,1fr)_auto]"
              >
                <p className="flex items-center gap-3">
                  <platform.Mark className="size-5 text-[var(--ink-2)]" />
                  <span className="d2-serif text-[1.35rem]">{platform.name}</span>
                </p>
                <div className="min-w-0">
                  <p className="d2-mono truncate text-[13px]">{platform.file}</p>
                  <p className="d2-soft mt-0.5 text-sm">{platform.note}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={platform.href} className="d2-btn d2-btn-ink !min-h-10 !text-sm">
                    {platform.action}
                  </a>
                  <Link href={platform.guide} className="d2-btn !min-h-10 !text-sm">
                    Install guide
                  </Link>
                </div>
              </Rv>
            ))}
          </ul>
          <p className="d2-faint mt-5 text-sm">
            All files are on the{" "}
            <a href={LATEST_RELEASE_URL} className="d2-link">
              latest release page
            </a>{" "}
            on GitHub.
          </p>
        </div>
        <Footnotes running="Download" folio={31} notes={[]} />
      </Page>
    </section>
  );
}

/** Back cover: the closing call to action. */
export function BackCover() {
  return (
    <section aria-labelledby="end-title" className="relative overflow-hidden border-t-[3px] border-double border-[var(--rule-3)]">
      <div aria-hidden className="d2-ruled pointer-events-none absolute inset-0 opacity-70" />
      <Page className="relative grid items-center gap-12 py-24 sm:py-32 lg:grid-cols-[minmax(0,1fr)_auto]">
        <Rv>
          <p className="d2-kicker">The end of the manual</p>
          <h2 id="end-title" className="d2-display mt-5 text-[3.2rem] sm:text-[4.6rem] lg:text-[5.4rem]">
            Start a new page<span className="text-[var(--verm)]">.</span>
          </h2>
          <p className="d2-soft mt-6 max-w-[46ch] text-lg leading-relaxed">
            Register to start planning, log in if you already have an account, or read the source on GitHub first.
          </p>
          <div className="mt-9 flex flex-wrap gap-2.5">
            <Link href="/signup" className="d2-btn d2-btn-verm !min-h-12 !px-6 !text-base">
              Register
            </Link>
            <Link href="/login" className="d2-btn !min-h-12 !px-6 !text-base">
              Log in
            </Link>
            <a href={REPO_URL} className="d2-btn !min-h-12 !px-6 !text-base">
              <GitHubMark className="size-[18px]" />
              GitHub
            </a>
          </div>
        </Rv>
        <ClosingStamp version={v} />
      </Page>
    </section>
  );
}
