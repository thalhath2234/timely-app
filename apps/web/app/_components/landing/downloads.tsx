import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AUR_URL, LATEST_RELEASE_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import { Reveal } from "./reveal";

const PLATFORMS = [
  {
    name: "Windows",
    mark: WindowsMark,
    file: "Timely-x.y.z-win-x64.exe",
    note: "Per-user installer. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download .exe" },
    guide: "/help/install/windows",
    color: "#7cc4ff",
  },
  {
    name: "Ubuntu",
    mark: UbuntuMark,
    file: "Timely-x.y.z-linux-x86_64.AppImage",
    note: "One file. Needs libfuse2. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download AppImage" },
    guide: "/help/install/ubuntu",
    color: "#ff9a6b",
  },
  {
    name: "Arch Linux",
    mark: ArchMark,
    file: "timely-bin",
    note: "From the AUR, updated with pacman.",
    download: { href: AUR_URL, label: "Open on the AUR" },
    guide: "/help/install/arch",
    color: "#5cc8ff",
  },
  {
    name: "Android",
    mark: AndroidMark,
    file: "Timely-x.y.z-android-arm64.apk",
    note: "Pairs with your computer by QR code.",
    download: { href: LATEST_RELEASE_URL, label: "Download .apk" },
    guide: "/help/install/android",
    color: "#4edea3",
  },
] as const;

/** Releases as a timetable: one row per platform, with the file it ships and where to go next. */
export default function Downloads() {
  return (
    <div className="mt-12 border-t border-[var(--lp-line)]">
      {PLATFORMS.map((platform, index) => (
        <Reveal
          key={platform.name}
          delay={index * 0.05}
          className="grid items-center gap-x-6 gap-y-3 border-b border-[var(--lp-line)] py-5 md:grid-cols-[220px_minmax(0,1fr)_auto]"
        >
          <div className="flex items-center gap-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-lg"
              style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 14%, transparent)` }}
            >
              <platform.mark className="size-5" />
            </span>
            <span className="text-lg font-semibold">{platform.name}</span>
          </div>
          <div className="min-w-0">
            <p className="lp-mono truncate text-sm text-[var(--lp-ink)]">{platform.file}</p>
            <p className="mt-0.5 text-sm text-[var(--lp-soft)]">{platform.note}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={platform.download.href} className="lp-btn lp-btn-primary !h-10 !text-sm">
              {platform.download.label}
              <ArrowUpRight className="size-4" />
            </a>
            <Link href={platform.guide} className="lp-btn lp-btn-ghost !h-10 !text-sm">
              Install guide
            </Link>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
