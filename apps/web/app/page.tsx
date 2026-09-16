import Link from "next/link";
import { Calendar, ListTodo, Brain, ArrowRight, ShieldCheck } from "lucide-react";

const FEATURES = [
  {
    title: "Fluid Calendar",
    description:
      "Organize appointments across Month, Week, and Day views with smooth, hardware-accelerated transitions.",
    icon: Calendar,
  },
  {
    title: "Task Boards",
    description:
      "Track to-dos, priorities, deadlines, and project labels with modern productivity views.",
    icon: ListTodo,
  },
  {
    title: "Productivity Reports",
    description:
      "Analyze focus hours, blockades, and scheduled activities through clean visual summaries.",
    icon: Brain,
  },
] as const;

export default function Home() {
  return (
    <div className="dark flex min-h-screen flex-col bg-[#0c0e14] text-[#e2e2eb] selection:bg-[#c0c1ff] selection:text-[#1000a9]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[#c0c1ff] text-[#1000a9]">
            <span className="text-sm font-bold select-none">T</span>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold tracking-tight">Timely</span>
            <span className="text-[0.6875rem] font-medium tracking-[0.02em] text-[#908fa0]">
              Productivity & Sheets Workspace
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-3 py-2 text-sm font-medium text-[#908fa0] transition-colors hover:text-[#e2e2eb]"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-[#e2e2eb] transition hover:bg-white/5"
          >
            Register
          </Link>
        </div>
      </header>

      <main id="main-content" className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-16 text-center">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#191b22] px-3 py-1.5 text-xs font-medium text-[#c7c4d7]">
          <ShieldCheck className="size-3.5 text-[#c0c1ff]" />
          Now Protected with Secure Cookie Sessions
        </div>

        <h1 className="max-w-3xl text-4xl font-bold tracking-[-0.03em] text-balance sm:text-6xl sm:leading-[1.05]">
          Manage Your Time
          <br />
          <span className="text-[#c0c1ff]">Effortlessly with Timely</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-[#908fa0] sm:text-lg">
          A beautiful, premium task manager and interactive calendar dashboard
          designed to keep your schedules, agendas, and analytical reports in
          perfect harmony.
        </p>

        <div className="mt-10 flex w-full max-w-sm flex-col items-center justify-center gap-3 sm:max-w-none sm:flex-row">
          <Link
            href="/signup"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#c0c1ff] px-6 text-sm font-semibold text-[#1000a9] transition hover:bg-[#a8a6ff] active:scale-[0.98] sm:w-auto"
          >
            Get Started Free
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/login"
            className="flex h-11 w-full items-center justify-center rounded-lg border border-white/10 bg-[#191b22] px-6 text-sm font-semibold text-[#e2e2eb] transition hover:bg-[#282a30] sm:w-auto"
          >
            Sign In
          </Link>
        </div>

        <div className="mt-20 grid w-full grid-cols-1 gap-4 text-left md:grid-cols-3">
          {FEATURES.map(({ title, description, icon: Icon }) => (
            <div
              key={title}
              className="rounded-xl border border-white/10 bg-[#191b22] p-6"
            >
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-[#c0c1ff]/20 bg-[#c0c1ff]/10">
                <Icon className="size-5 text-[#c0c1ff]" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#908fa0]">
                {description}
              </p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-white/10 px-6 py-8 text-center text-xs text-[#464554]">
        © {new Date().getFullYear()} Timely Inc. All rights reserved.
      </footer>
    </div>
  );
}
