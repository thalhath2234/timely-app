import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Info, Lightbulb } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";
import CopyButton from "./copyButton";

/** Building blocks for help articles. Screenshots live in public/help. */

const DESKTOP = { width: 1920, height: 1200 };
const PHONE = { width: 780, height: 1688 };

export function Shot({ src, alt, caption }: { src: string; alt: string; caption?: ReactNode }) {
  return (
    <figure className="not-prose my-7">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111319] p-1 shadow-[0_24px_70px_-30px_rgba(129,131,244,0.45)]">
        <Image
          src={`/help/${src}.webp`}
          alt={alt}
          {...DESKTOP}
          sizes="(min-width: 1280px) 760px, (min-width: 768px) 70vw, 100vw"
          className="block h-auto w-full rounded-[13px]"
        />
      </div>
      {caption ? <figcaption className="s-faint mt-2.5 text-center text-sm">{caption}</figcaption> : null}
    </figure>
  );
}

export function PhoneShots({ shots, caption }: { shots: { src: string; alt: string }[]; caption?: ReactNode }) {
  return (
    <figure className="my-7">
      <div className={cn("grid gap-3", shots.length >= 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
        {shots.map((shot) => (
          <div
            key={shot.src}
            className="mx-auto w-full max-w-[240px] overflow-hidden rounded-[26px] border border-white/12 bg-[#111319] p-1.5"
          >
            <Image
              src={`/help/${shot.src}.webp`}
              alt={shot.alt}
              {...PHONE}
              sizes="240px"
              className="block h-auto w-full rounded-[20px]"
            />
          </div>
        ))}
      </div>
      {caption ? <figcaption className="s-faint mt-2.5 text-center text-sm">{caption}</figcaption> : null}
    </figure>
  );
}

const CALLOUT = {
  note: { icon: Info, color: "#7cc4ff", label: "Note" },
  tip: { icon: Lightbulb, color: "#4edea3", label: "Tip" },
  warning: { icon: AlertTriangle, color: "#ffb95f", label: "Heads up" },
} as const;

export function Callout({ kind = "note", children }: { kind?: keyof typeof CALLOUT; children: ReactNode }) {
  const { icon: Icon, color, label } = CALLOUT[kind];
  return (
    <div
      className="flex gap-3 rounded-xl border px-4 py-3.5 text-[0.9375rem] leading-relaxed"
      style={{ borderColor: `color-mix(in oklch, ${color} 30%, transparent)`, background: `color-mix(in oklch, ${color} 7%, transparent)` }}
    >
      <Icon className="mt-1 size-4 shrink-0" style={{ color }} aria-hidden />
      <div>
        <span className="sr-only">{label}: </span>
        {children}
      </div>
    </div>
  );
}

/** Numbered steps; each child is one step. */
export function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="!list-none !pl-0">
      {children.map((child, index) => (
        <li key={index} className="relative !mt-0 pb-5 pl-11 last:pb-0">
          {index < children.length - 1 ? (
            <span aria-hidden className="absolute top-8 bottom-1 left-[13px] w-px bg-white/10" />
          ) : null}
          <span
            aria-hidden
            className="absolute top-0.5 left-0 flex size-7 items-center justify-center rounded-full border border-[#c0c1ff]/35 bg-[#c0c1ff]/10 text-xs font-semibold text-[#c0c1ff]"
          >
            {index + 1}
          </span>
          {child}
        </li>
      ))}
    </ol>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <div className="group relative">
      <pre>
        <code>{children}</code>
      </pre>
      <CopyButton text={children} />
    </div>
  );
}

/** The arrow-separated path to a setting, e.g. Settings → Schedule. */
export function Path({ children }: { children: string }) {
  return <strong className="whitespace-nowrap">{children.split(">").map((part) => part.trim()).join(" → ")}</strong>;
}

export function DownloadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="not-prose s-btn-primary !inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold !text-[var(--s-primary-ink)] !no-underline"
    >
      {children}
      <ArrowUpRight className="size-4" />
    </a>
  );
}

export function HelpLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href}>{children}</Link>;
}
