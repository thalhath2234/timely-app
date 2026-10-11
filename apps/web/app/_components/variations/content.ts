/**
 * Copy shared by the landing and help-center design variations (/2 to /5).
 * Every variation says the same things in its own layout, so the facts live
 * here once: what Timely does, why the AI matters, where to install it.
 */

import { AUR_URL, LATEST_RELEASE_URL } from "@/app/_components/site/links";
import { AndroidMark, ArchMark, UbuntuMark, WindowsMark } from "@/app/_components/site/marks";

/** The app's project colours (app/utils/entityColor.ts), the only accents a variation should use. */
export const PALETTE = {
  primary: "#c0c1ff",
  primaryInk: "#1000a9",
  green: "#30a66d",
  violet: "#6e56cf",
  amber: "#ffb224",
  blue: "#0090ff",
  pink: "#e93d82",
  cyan: "#00a2c7",
  orange: "#f76808",
  plum: "#ab4aba",
  indigo: "#3e63dd",
  teal: "#12a594",
  lime: "#99d52a",
  red: "#e5484d",
} as const;

export const TAGLINE = "Write it down. Timely finds the time.";

export const PITCH =
  "A private planner with an AI assistant that runs on the Claude or ChatGPT subscription you already have. Capture a thought and Timely places it on your week, with smart suggestions, docs, sheets and an MCP server for your own agents. Open source, for Windows, Linux and Android.";

/** The four steps everything in Timely follows. */
export const LOOP = [
  {
    step: "Capture",
    color: PALETTE.green,
    title: "Get it out of your head.",
    body: "Type a thought into the Inbox the moment it shows up. It needs nothing but a title.",
    href: "/help/plan/inbox",
  },
  {
    step: "Clarify",
    color: PALETTE.violet,
    title: "Decide what each thing is.",
    body: "Work that takes time, or a reminder at a set time. Smart suggestions fill in the length, the workspace and a deadline.",
    href: "/help/plan/inbox",
  },
  {
    step: "Schedule",
    color: PALETTE.blue,
    title: "Let the week arrange itself.",
    body: "Auto-schedule places work in free time inside your working hours, around your meetings. Pins stay put.",
    href: "/help/plan/auto-schedule",
  },
  {
    step: "Focus",
    color: PALETTE.amber,
    title: "Do the next thing.",
    body: "Today shows what is up, with a timer, your habits and your goals. Tick it off and the week moves on.",
    href: "/help/plan/today",
  },
] as const;

/** Why the assistant is the point: your own subscription, suggestions, agents. */
export const AI_POINTS = [
  {
    id: "subscriptions",
    title: "Bring the AI you already pay for",
    body: "Sign in with your Claude or ChatGPT subscription through Claude Code or Codex, or paste any provider's key. Timely never sells you a second plan.",
    href: "/help/assistant/subscriptions",
    color: PALETTE.primary,
  },
  {
    id: "assistant",
    title: "An assistant that proposes, you approve",
    body: "Ask for a plan, a doc or a cleared Inbox. It shows each change as a card; nothing happens until you say so.",
    href: "/help/assistant/chat",
    color: PALETTE.pink,
  },
  {
    id: "suggestions",
    title: "Smart suggestions, everywhere",
    body: "Capture a thought and the length, workspace, labels and deadline are already filled in. Docs and sheets get templates and hints.",
    href: "/help/assistant/smart-suggestions",
    color: PALETTE.amber,
  },
  {
    id: "mcp",
    title: "Your own agents plug straight in",
    body: "Timely is an MCP server. Point Claude Code, Codex or any agent at it and they can read your plan and add to it.",
    href: "/help/assistant/mcp",
    color: PALETTE.cyan,
  },
] as const;

/** Everything else, each one linked to its help article. */
export const FEATURES = [
  {
    title: "Your calendar rearranges itself",
    body: "Work lands in free time inside your working hours. When a meeting appears, the next run moves what it overlaps.",
    href: "/help/plan/auto-schedule",
    color: PALETTE.violet,
  },
  {
    title: "Docs and sheets, next to the work",
    body: "Every project can hold its own docs and sheets. Search finds them and the assistant writes and fills them.",
    href: "/help/notes/docs",
    color: PALETTE.amber,
  },
  {
    title: "Find anything from one box",
    body: "Search tasks, projects, docs, sheets and events, or create something new from the same place.",
    href: "/help/notes/search",
    color: PALETTE.cyan,
  },
  {
    title: "A dashboard you arrange yourself",
    body: "Drag and resize cards for focus time, deadlines, a Pomodoro timer, a journal and more. Your layout is saved.",
    href: "/help/notes/dashboard",
    color: PALETTE.orange,
  },
  {
    title: "Habits and goals, kept in view",
    body: "Tick habits on Today or on your phone's Home screen and watch the streak grow next to your goals.",
    href: "/help/plan/today",
    color: PALETTE.green,
  },
  {
    title: "List, board and Gantt",
    body: "The same tasks as a list, a board by stage, or a Gantt chart across weeks. Projects and stages keep them in order.",
    href: "/help/organize/views",
    color: PALETTE.blue,
  },
] as const;

/** Why it is private: the desktop app brings its own server. */
export const PRIVACY = [
  {
    title: "Your data stays home",
    body: "The desktop app bundles its own server and database in your app data folder. It listens on this computer only unless you turn on Tailscale access.",
  },
  {
    title: "Your own AI account",
    body: "The assistant runs on your Claude or ChatGPT sign-in, or your own API key, stored encrypted. Without one, everything else still works.",
  },
  {
    title: "Your phone, paired to it",
    body: "The Android app pairs with your computer by QR code and talks to it over your own Tailscale network. Nothing goes through someone else's cloud.",
  },
  {
    title: "Backups built in",
    body: "Encrypted account backups on a schedule, a full JSON export, and an automatic copy before every upgrade.",
  },
] as const;

export const PLATFORMS = [
  {
    id: "windows",
    name: "Windows",
    mark: WindowsMark,
    file: "Timely-x.y.z-win-x64.exe",
    note: "Per-user installer for Windows 10 and 11. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download .exe" },
    guide: "/help/install/windows",
    color: "#7cc4ff",
  },
  {
    id: "ubuntu",
    name: "Ubuntu",
    mark: UbuntuMark,
    file: "Timely-x.y.z-linux-x86_64.AppImage",
    note: "One AppImage for Ubuntu and Debian. Needs libfuse2. Updates itself.",
    download: { href: LATEST_RELEASE_URL, label: "Download AppImage" },
    guide: "/help/install/ubuntu",
    color: "#ff9a6b",
  },
  {
    id: "arch",
    name: "Arch Linux",
    mark: ArchMark,
    file: "timely-bin",
    note: "From the AUR, updated with pacman.",
    download: { href: AUR_URL, label: "Open on the AUR" },
    guide: "/help/install/arch",
    color: "#5cc8ff",
  },
  {
    id: "android",
    name: "Android",
    mark: AndroidMark,
    file: "Timely-x.y.z-android-arm64.apk",
    note: "Pairs with your computer by QR code.",
    download: { href: LATEST_RELEASE_URL, label: "Download .apk" },
    guide: "/help/install/android",
    color: "#4edea3",
  },
] as const;

/** Help-center shortcuts people ask for most. */
export const HELP_POPULAR = [
  { label: "Use your Claude or ChatGPT plan", href: "/help/assistant/subscriptions" },
  { label: "Install on Windows", href: "/help/install/windows" },
  { label: "Auto-schedule", href: "/help/plan/auto-schedule" },
  { label: "Pair your phone", href: "/help/install/android#pair" },
  { label: "Connect an agent", href: "/help/assistant/mcp" },
  { label: "Export, backup and restore", href: "/help/account/backups" },
] as const;

/** Questions a visitor might type into a help search, each answered by an article. */
export const HELP_QUESTIONS = [
  { q: "Can I use my own Claude subscription?", href: "/help/assistant/subscriptions" },
  { q: "Why did my task move to Thursday?", href: "/help/plan/auto-schedule" },
  { q: "How do I get it on my phone?", href: "/help/install/android" },
  { q: "Where is my data kept?", href: "/help/account/backups" },
  { q: "Can Claude Code read my plan?", href: "/help/assistant/mcp" },
  { q: "What is the Inbox for?", href: "/help/plan/inbox" },
] as const;
