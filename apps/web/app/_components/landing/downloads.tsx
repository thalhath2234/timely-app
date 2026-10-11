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

export default function Downloads() {
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {PLATFORMS.map((platform, index) => (
        <Reveal key={platform.name} delay={index * 0.08} className="s-card flex flex-col rounded-2xl p-5">
          <span
            className="flex size-11 items-center justify-center rounded-xl border border-white/10"
            style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 12%, transparent)` }}
          >
            <platform.mark className="size-5" />
          </span>
          <h3 className="mt-4 text-lg font-semibold">{platform.name}</h3>
          <p className="s-soft mt-1 text-sm">{platform.note}</p>
          <p className="s-faint mt-3 truncate font-mono text-xs">{platform.file}</p>
          <div className="mt-auto flex flex-col gap-2 pt-5">
            <a
              href={platform.download.href}
              className="s-btn-primary inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold"
            >
              {platform.download.label}
              <ArrowUpRight className="size-4" />
            </a>
            <Link href={platform.guide} className="s-btn-ghost rounded-full px-4 py-2 text-center text-sm font-medium">
              Install guide
            </Link>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
