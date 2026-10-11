import { AUR_URL, LATEST_RELEASE_URL, REPO_URL } from "@/app/_components/site/links";
import packageJson from "@/package.json";

export const BASE = "/3";
export const VERSION = packageJson.version;

export const NAV = [
  { label: "AI", href: `${BASE}#ai`, key: "1" },
  { label: "How it works", href: `${BASE}#how-it-works`, key: "2" },
  { label: "Docs and sheets", href: `${BASE}#docs-and-sheets`, key: "3" },
  { label: "Download", href: `${BASE}#download`, key: "4" },
  { label: "Help", href: `${BASE}/help`, key: "5" },
] as const;

export const ACCOUNT = {
  register: "/signup",
  login: "/login",
  github: REPO_URL,
};

export type PlatformId = "windows" | "ubuntu" | "arch" | "android";

export const PLATFORMS: {
  id: PlatformId;
  name: string;
  file: string;
  note: string;
  command?: string;
  download: { href: string; label: string };
  guide: string;
}[] = [
  {
    id: "windows",
    name: "Windows",
    file: `Timely-${VERSION}-win-x64.exe`,
    note: "Per-user installer for Windows 10 and 11. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download .exe" },
    guide: "/help/install/windows",
  },
  {
    id: "ubuntu",
    name: "Ubuntu",
    file: `Timely-${VERSION}-linux-x86_64.AppImage`,
    note: "One file for Ubuntu and Debian. Needs libfuse2. Updates itself.",
    command: "sudo apt install libfuse2",
    download: { href: LATEST_RELEASE_URL, label: "Download AppImage" },
    guide: "/help/install/ubuntu",
  },
  {
    id: "arch",
    name: "Arch Linux",
    file: "timely-bin",
    note: "From the AUR, updated with the rest of your system.",
    command: "yay -S timely-bin",
    download: { href: AUR_URL, label: "Open on the AUR" },
    guide: "/help/install/arch",
  },
  {
    id: "android",
    name: "Android",
    file: `Timely-${VERSION}-android-arm64.apk`,
    note: "Pairs with your computer by QR code.",
    download: { href: LATEST_RELEASE_URL, label: "Download .apk" },
    guide: "/help/install/android",
  },
];
