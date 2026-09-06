"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import DemoBadge from "./DemoBadge";

interface MobileHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  actions?: ReactNode;
  isDemo?: boolean;
  /** Renders below the title row (segmented controls, date strips). */
  children?: ReactNode;
  large?: boolean;
}

export default function MobileHeader({
  title,
  subtitle,
  backHref,
  actions,
  isDemo,
  children,
  large = true,
}: MobileHeaderProps) {
  const router = useRouter();

  return (
    <header className="shrink-0 border-b border-border bg-background/95 backdrop-blur pt-safe">
      <div className="flex min-h-14 items-center gap-1 px-2">
        {backHref ? (
          <button
            type="button"
            onClick={() => router.push(backHref)}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-full text-foreground active:bg-muted"
          >
            <ChevronLeft size={24} />
          </button>
        ) : null}
        <div className={`min-w-0 flex-1 ${backHref ? "" : "px-2"}`}>
          <h1
            className={`truncate font-semibold tracking-tight text-foreground ${
              large ? "text-[22px]" : "text-[17px]"
            }`}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {isDemo ? <DemoBadge /> : null}
          {actions}
        </div>
      </div>
      {children}
    </header>
  );
}

export function HeaderIconButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors active:bg-muted ${
        active ? "text-primary" : "text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
