import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AUR_URL, LATEST_RELEASE_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import { C } from "./data";

export const PLATFORMS = [
  {
    name: "Windows",
    mark: WindowsMark,
    file: "Timely-x.y.z-win-x64.exe",
    note: "Per-user installer. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download .exe" },
    guide: "/help/install/windows",
    color: C.blue.bg,
  },
  {
    name: "Ubuntu",
    mark: UbuntuMark,
    file: "Timely-x.y.z-linux-x86_64.AppImage",
    note: "One file. Needs libfuse2. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download AppImage" },
    guide: "/help/install/ubuntu",
    color: C.orange.bg,
  },
  {
    name: "Arch Linux",
    mark: ArchMark,
    file: "timely-bin",
    note: "From the AUR, updated with pacman.",
    download: { href: AUR_URL, label: "Open on the AUR" },
    guide: "/help/install/arch",
    color: C.cyan.bg,
  },
  {
    name: "Android",
    mark: AndroidMark,
    file: "Timely-x.y.z-android-arm64.apk",
    note: "Pairs with your computer by QR code.",
    download: { href: LATEST_RELEASE_URL, label: "Download .apk" },
    guide: "/help/install/android",
    color: C.green.bg,
  },
] as const;

/** The releases as a timetable: one row per platform, the file it ships, and where to go next. */
export default function Downloads() {
  return (
    <div className="border-t-2 border-[var(--ink)]">
      <div className="d4-label hidden grid-cols-12 border-b border-[var(--line-2)] py-2.5 text-[var(--faint)] md:grid">
        <span className="col-span-3">Platform</span>
        <span className="col-span-5">File and notes</span>
        <span className="col-span-4">Get it</span>
      </div>
      {PLATFORMS.map((platform, index) => (
        <div key={platform.name} className="d4-row grid grid-cols-4 gap-y-3 border-b border-[var(--line-2)] py-5 md:grid-cols-12 md:items-center md:py-6" style={{ "--c": platform.color } as React.CSSProperties}>
          <div className="col-span-4 flex items-center gap-3 md:col-span-3 md:pl-4">
            <span className="d4-mono w-6 text-[11px] text-[var(--faint)]">{String(index + 1).padStart(2, "0")}</span>
            <span className="flex size-10 shrink-0 items-center justify-center" style={{ background: platform.color, color: "#0a0a0a" }}>
              <platform.mark className="size-5" />
            </span>
            <span className="text-[1.6rem] leading-none font-bold tracking-[-0.04em] md:text-[1.9rem]">{platform.name}</span>
          </div>
          <div className="col-span-4 min-w-0 md:col-span-5 md:pr-6">
            <p className="d4-mono truncate text-[14px]">{platform.file}</p>
            <p className="mt-1 text-[14px] text-[var(--soft)]">{platform.note}</p>
          </div>
          <div className="col-span-4 flex flex-wrap gap-2 md:col-span-4">
            <a href={platform.download.href} className="d4-btn d4-btn-solid">
              {platform.download.label}
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
            <Link href={platform.guide} className="d4-btn">
              Install guide
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
