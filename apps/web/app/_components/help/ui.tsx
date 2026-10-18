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
      <div className="overflow-hidden rounded-[12px] border border-[var(--s-line-strong)] bg-[var(--s-panel)] p-1 shadow-[0_24px_70px_-40px_rgba(0,0,0,0.9)]">
        <Image
          src={`/help/${src}.webp`}
          alt={alt}
          {...DESKTOP}
          sizes="(min-width: 1280px) 760px, (min-width: 768px) 70vw, 100vw"
          className="block h-auto w-full rounded-[8px]"
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
            className="mx-auto w-full max-w-[240px] overflow-hidden rounded-[16px] border border-[var(--s-line-strong)] bg-[var(--s-panel)] p-1.5"
          >
            <Image
              src={`/help/${shot.src}.webp`}
              alt={shot.alt}
              {...PHONE}
              sizes="240px"
              className="block h-auto w-full rounded-[16px]"
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
      className="flex gap-3 rounded-[12px] border px-4 py-3.5 text-[0.9375rem] leading-relaxed"
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
            className="absolute top-0.5 left-0 flex size-7 items-center justify-center rounded-full border border-[color-mix(in_oklch,var(--s-primary)_35%,transparent)] bg-[color-mix(in_oklch,var(--s-primary)_10%,transparent)] text-xs font-semibold text-[var(--s-primary)]"
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
      className="not-prose s-btn s-btn-primary !inline-flex !text-[var(--s-primary-ink)] !no-underline"
    >
      {children}
      <ArrowUpRight className="size-4" />
    </a>
  );
}

export function HelpLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href}>{children}</Link>;
}
