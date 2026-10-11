import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { AUR_URL, LATEST_RELEASE_URL, REPO_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, GitHubMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import pkg from "@/package.json";

const PLATFORMS = [
  {
    name: "Windows",
    mark: WindowsMark,
    file: `Timely-${pkg.version}-win-x64.exe`,
    note: "Per-user installer. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download .exe" },
    guide: "/help/install/windows",
  },
  {
    name: "Ubuntu",
    mark: UbuntuMark,
    file: `Timely-${pkg.version}-linux-x86_64.AppImage`,
    note: "One file. Needs libfuse2. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download AppImage" },
    guide: "/help/install/ubuntu",
  },
  {
    name: "Arch Linux",
    mark: ArchMark,
    file: "timely-bin",
    note: "From the AUR, updated with pacman.",
    download: { href: AUR_URL, label: "Open on the AUR" },
    guide: "/help/install/arch",
  },
  {
    name: "Android",
    mark: AndroidMark,
    file: `Timely-${pkg.version}-android-arm64.apk`,
    note: "Pairs with your computer by QR code.",
    download: { href: LATEST_RELEASE_URL, label: "Download .apk" },
    guide: "/help/install/android",
  },
];

export function Downloads() {
  return (
    <div className="dl">
      {PLATFORMS.map((platform) => (
        <div key={platform.name} className="dl-row">
          <div className="dl-name">
            <span className="dl-mark">
              <platform.mark className="size-5" />
            </span>
            {platform.name}
          </div>
          <div className="min-w-0">
            <p className="dl-file">{platform.file}</p>
            <p className="mt-1 text-[15.5px] text-[var(--soft)]">{platform.note}</p>
          </div>
          <div className="dl-actions">
            <a href={platform.download.href} className="btn btn-mint btn-sm">
              {platform.download.label}
              <ArrowUpRight className="size-4" />
            </a>
            <Link href={platform.guide} className="btn btn-line btn-sm">
              Install guide
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The cycle is complete: four filled sessions and one last button. */
export function Closing() {
  return (
    <section className="close-sec" data-phase="Cycle complete" aria-labelledby="d5-close-title">
      <div className="wrap close">
        <div className="relative mx-auto size-[220px] sm:size-[280px]" aria-hidden>
          <svg viewBox="0 0 200 200" className="size-full overflow-visible">
            <circle
              className="breathe"
              cx="100"
              cy="100"
              r="96"
              fill="none"
              stroke="rgb(168 224 195 / 16%)"
              strokeWidth="1"
            />
            <circle cx="100" cy="100" r="84" fill="rgb(16 28 24 / 60%)" stroke="var(--mint)" strokeWidth="3" />
            {[0, 1, 2, 3].map((i) => {
              const a = (i / 4) * Math.PI * 2;
              return (
                <circle
                  key={i}
                  cx={100 + Math.sin(a) * 84}
                  cy={100 - Math.cos(a) * 84}
                  r="7"
                  fill="var(--mint)"
                  stroke="#0a1210"
                  strokeWidth="3"
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="num text-[44px] leading-none font-extralight tracking-[-0.03em] sm:text-[56px]">
              4 / 4
            </span>
            <span className="mt-2 text-[14px] text-[var(--soft)]">sessions done</span>
          </div>
        </div>
        <div>
          <p className="label" style={{ color: "var(--mint)" }}>
            Cycle complete
          </p>
          <h2
            id="d5-close-title"
            className="mt-4 max-w-[16ch] text-[clamp(2.3rem,5vw,3.8rem)] leading-[1.04] font-light tracking-[-0.03em]"
          >
            Your week, kept <span className="it text-[var(--mint)]">quietly</span> in order.
          </h2>
          <p className="mt-5 max-w-[34rem] text-[19px] text-[var(--soft)]">
            Register, write down the first thing on your mind, and let Timely find it an hour this week.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Link href="/signup" className="btn btn-mint">
              Register
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/login" className="btn btn-line">
              Log in
            </Link>
            <a href={REPO_URL} className="btn btn-line">
              <GitHubMark className="size-[18px]" />
              GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
