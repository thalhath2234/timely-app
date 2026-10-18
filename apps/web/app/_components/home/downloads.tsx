import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AUR_URL, LATEST_RELEASE_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";
import { Reveal } from "./reveal";

const PLATFORMS = [
  { name: "Windows", detail: "Installer for Windows 10 and 11", mark: WindowsMark, color: "#7cc4ff", href: LATEST_RELEASE_URL, guide: "/help/install/windows" },
  { name: "Ubuntu", detail: "AppImage, also for Debian", mark: UbuntuMark, color: "#ff9a6b", href: LATEST_RELEASE_URL, guide: "/help/install/ubuntu" },
  { name: "Arch Linux", detail: "timely-bin from the AUR", mark: ArchMark, color: "#5cc8ff", href: AUR_URL, guide: "/help/install/arch" },
  { name: "Android", detail: "APK that pairs by QR code", mark: AndroidMark, color: "#4edea3", href: LATEST_RELEASE_URL, guide: "/help/install/android" },
];

export default function Downloads({ version }: { version: string }) {
  return (
    <section id="download" className="grid scroll-mt-20 gap-8 border-t border-[var(--s-line)] py-14 lg:grid-cols-12 lg:gap-12 lg:py-20">
      <Reveal className="lg:col-span-4">
        <p className="s-eyebrow">Download · v{version}</p>
        <h2 className="s-display mt-4 text-[2rem] sm:text-[2.6rem]">Windows, Linux, Android.</h2>
        <p className="s-soft mt-4 max-w-[40ch] leading-relaxed">Every release ships all three. No macOS yet. Each card has a step-by-step guide in the help center.</p>
      </Reveal>
      <Reveal className="lg:col-span-8">
        <ul className="grid gap-3 sm:grid-cols-2">
          {PLATFORMS.map((platform) => (
            <li key={platform.name} className="s-card s-card-hover flex items-center gap-4 p-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-[10px]" style={{ color: platform.color, background: `color-mix(in oklch, ${platform.color} 12%, transparent)` }}>
                <platform.mark className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{platform.name}</span>
                <span className="s-faint block text-sm">{platform.detail}</span>
                <Link href={platform.guide} className="s-link mt-1 inline-block text-xs font-medium underline-offset-4 hover:underline">
                  Install guide
                </Link>
              </span>
              <a href={platform.href} className="s-btn s-btn-ghost h-9 px-3 text-sm">
                Download
                <ArrowUpRight className="size-3.5" />
              </a>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
