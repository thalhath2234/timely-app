import { cn } from "@/app/utils/cn";

/**
 * The Timely mark ("1a Agenda" from the logo exploration): three Blocks, the
 * middle one an Engine block. Ink follows `currentColor` and the accent bar
 * follows the theme's primary, so it reads in both modes and picks up the
 * account's accent.
 */
const BARS = [
  { y: 5.5, width: 24, accent: false, delay: 0 },
  { y: 21, width: 20, accent: false, delay: 0.04 },
  { y: 13.25, width: 15, accent: true, delay: 0.1 },
] as const;

/**
 * "brand" colours the middle block with the theme primary. Use "mono" on
 * primary-coloured surfaces (buttons, tinted pills) where the primary would
 * vanish; the middle block then follows `currentColor` at reduced opacity.
 */
export type LogoTone = "brand" | "mono";

/** Seconds per loop for the full-screen loader and for inline spinners. */
export const LOGO_LOOP_SECONDS = 4;
export const SPINNER_LOOP_SECONDS = 2.6;

type TimelyLogoProps = {
  size?: number;
  className?: string;
  /** Loop the "blocks being placed" animation. Honors prefers-reduced-motion. */
  animated?: boolean;
  /** Seconds per loop when animated. */
  duration?: number;
  tone?: LogoTone;
  title?: string;
};

export default function TimelyLogo({
  size = 28,
  className,
  animated = false,
  duration = LOGO_LOOP_SECONDS,
  tone = "brand",
  title,
}: TimelyLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0 overflow-visible", className)}
    >
      {title ? <title>{title}</title> : null}
      {BARS.map((bar) => (
        <rect
          key={bar.y}
          x={4}
          y={bar.y}
          width={bar.width}
          height={5.5}
          rx={2.75}
          fill={bar.accent && tone === "brand" ? undefined : "currentColor"}
          fillOpacity={bar.accent && tone === "mono" ? 0.55 : undefined}
          className={cn(bar.accent && tone === "brand" && "fill-primary", animated && "tl-bar")}
          style={
            animated
              ? ({
                  "--tl-duration": `${duration}s`,
                  "--tl-delay": `${bar.delay * duration}s`,
                } as React.CSSProperties)
              : undefined
          }
        />
      ))}
    </svg>
  );
}

/**
 * Wordmark lockup from the design: the 28px mark beside "Timely" at 24px,
 * semibold, tracking -0.03em.
 */
export function TimelyWordmark({
  size = 28,
  className,
  textClassName,
}: {
  size?: number;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <TimelyLogo size={size} />
      <span className={cn("text-2xl font-semibold tracking-[-0.03em]", textClassName)}>Timely</span>
    </span>
  );
}

/** Full-area loading state: the animated mark centered, with an optional label. */
export function LogoLoader({
  label = "Loading",
  size = 56,
  className,
}: {
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex h-full min-h-40 w-full flex-col items-center justify-center gap-4 text-foreground", className)}
    >
      <TimelyLogo size={size} animated />
      <span className="text-[13px] font-semibold tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * Inline busy indicator: the animated mark at icon size, looping faster than
 * the full-screen loader. Drop-in for a spinning `Loader2`; pass `tone="mono"`
 * inside primary buttons and tinted pills.
 */
export function LogoSpinner({
  size = 16,
  tone,
  className,
  label = "Loading",
}: {
  size?: number;
  tone?: LogoTone;
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" className={cn("inline-flex shrink-0", className)}>
      <TimelyLogo size={size} animated duration={SPINNER_LOOP_SECONDS} tone={tone} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
