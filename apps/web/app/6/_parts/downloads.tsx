import Link from "next/link";
import { ArrowDownToLine, BookOpen } from "lucide-react";
import { AUR_URL, LATEST_RELEASE_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import { noteStyle, type NoteColor } from "./paper";

export const PLATFORMS: {
  name: string;
  mark: (props: { className?: string }) => React.ReactNode;
  file: string;
  note: string;
  download: { href: string; label: string };
  guide: string;
  color: NoteColor;
  rotate: number;
}[] = [
  {
    name: "Windows",
    mark: WindowsMark,
    file: "Timely-x.y.z-win-x64.exe",
    note: "Per-user installer. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download .exe" },
    guide: "/help/install/windows",
    color: "blue",
    rotate: -1.6,
  },
  {
    name: "Ubuntu",
    mark: UbuntuMark,
    file: "Timely-x.y.z-linux-x86_64.AppImage",
    note: "One file. Needs libfuse2. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download AppImage" },
    guide: "/help/install/ubuntu",
    color: "orange",
    rotate: 1.2,
  },
  {
    name: "Arch Linux",
    mark: ArchMark,
    file: "timely-bin",
    note: "From the AUR, updated with pacman.",
    download: { href: AUR_URL, label: "Open on the AUR" },
    guide: "/help/install/arch",
    color: "violet",
    rotate: -0.8,
  },
  {
    name: "Android",
    mark: AndroidMark,
    file: "Timely-x.y.z-android-arm64.apk",
    note: "Pairs with your computer by QR code.",
    download: { href: LATEST_RELEASE_URL, label: "Download .apk" },
    guide: "/help/install/android",
    color: "green",
    rotate: 1.8,
  },
];

export default function Downloads() {
  return (
    <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {PLATFORMS.map((platform) => (
        <li key={platform.name}>
          <article
            className="d6-note d6-tilt relative flex h-full flex-col p-5"
            style={noteStyle(platform.color, 0, { ["--tilt" as string]: `${platform.rotate}deg` })}
          >
            <span aria-hidden className="absolute top-3 right-4 size-3 rounded-full bg-[var(--desk)] shadow-[inset_0_1px_2px_rgb(0_0_0/0.6)]" />
            <platform.mark className="size-8" />
            <h3 className="d6-display mt-4 text-[1.5rem] leading-none font-extrabold">{platform.name}</h3>
            <p className="d6-mono mt-3 text-[0.76rem] font-semibold">
              {platform.file.split("-").map((part, index) => (
                <span key={part}>
                  {index ? "-" : ""}
                  {index ? <wbr /> : null}
                  {part}
                </span>
              ))}
            </p>
            <p className="mt-1.5 text-[0.92rem] leading-snug font-medium text-[var(--paper-soft)]">{platform.note}</p>
            <div className="mt-auto flex flex-col gap-2 pt-6">
              <a href={platform.download.href} className="d6-btn d6-btn-ink w-full !text-[0.92rem]">
                <ArrowDownToLine className="size-4" />
                {platform.download.label}
              </a>
              <Link href={platform.guide} className="d6-btn d6-btn-paper-line w-full !text-[0.92rem]">
                <BookOpen className="size-4" />
                Install guide
              </Link>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
