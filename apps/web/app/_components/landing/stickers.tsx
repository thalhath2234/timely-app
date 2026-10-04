import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/**
 * Flat die-cut stickers and abstract shapes, drawn inline on a 64-unit grid.
 * They are decoration only: every one is aria-hidden, and each takes its
 * colour from the `--hue` of the section it sits in.
 */

const INK = "#17102b";
const PAPER = "#ffffff";
const HUE = "var(--hue)";
const HUE_LIGHT = "color-mix(in oklch, var(--hue) 45%, white)";
const HUE_DEEP = "color-mix(in oklch, var(--hue) 72%, #17102b)";

export type StickerName =
  | "tray"
  | "bell"
  | "calendar"
  | "stopwatch"
  | "chart"
  | "chat"
  | "pencil"
  | "magnifier"
  | "phone"
  | "star"
  | "sparkle";

/** Each sticker is its silhouette (used for the white die-cut edge) plus the artwork on top. */
const STICKERS: Record<StickerName, { outline: string; art: ReactNode }> = {
  tray: {
    outline: "M9 31 18 12h28l9 19v19a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4Z",
    art: (
      <>
        <path d="M9 31 18 12h28l9 19v19a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4Z" fill={HUE_LIGHT} />
        <path d="M9 31h14a9 9 0 0 0 18 0h14v19a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4Z" fill={HUE} />
        <path d="M24 20h16M22 25h20" stroke={HUE_DEEP} strokeWidth="2.5" strokeLinecap="round" />
      </>
    ),
  },
  bell: {
    outline:
      "M32 7a4 4 0 0 1 4 4v1.4C43.6 14.4 49 21.6 49 30v10l5 8H10l5-8V30c0-8.4 5.4-15.6 13-17.6V11a4 4 0 0 1 4-4ZM25 50a7 7 0 0 0 14 0Z",
    art: (
      <>
        <path d="M25 50a7 7 0 0 0 14 0Z" fill={HUE_DEEP} />
        <path
          d="M32 7a4 4 0 0 1 4 4v1.4C43.6 14.4 49 21.6 49 30v10l5 8H10l5-8V30c0-8.4 5.4-15.6 13-17.6V11a4 4 0 0 1 4-4Z"
          fill={HUE}
        />
        <path d="M22 30c0-5 3-9 7-10.5" stroke={PAPER} strokeWidth="3" strokeLinecap="round" opacity="0.75" />
      </>
    ),
  },
  calendar: {
    outline: "M16 10h32a8 8 0 0 1 8 8v30a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8Z",
    art: (
      <>
        <rect x="8" y="10" width="48" height="46" rx="8" fill={HUE_LIGHT} />
        <path d="M8 18a8 8 0 0 1 8-8h32a8 8 0 0 1 8 8v6H8Z" fill={HUE} />
        <path d="M21 6v9M43 6v9" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        <path d="m32 28 2.8 6.7 6.7 2.8-6.7 2.8L32 47l-2.8-6.7-6.7-2.8 6.7-2.8Z" fill={HUE_DEEP} />
      </>
    ),
  },
  stopwatch: {
    outline: "M27 5h10v6.6A22 22 0 1 1 27 11.6Z",
    art: (
      <>
        <rect x="27" y="5" width="10" height="9" rx="2" fill={HUE_DEEP} />
        <circle cx="32" cy="35" r="22" fill={HUE} />
        <circle cx="32" cy="35" r="15.5" fill={PAPER} />
        <path d="M32 35V24M32 35l8 5" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      </>
    ),
  },
  chart: {
    outline: "M15 8h34a7 7 0 0 1 7 7v34a7 7 0 0 1-7 7H15a7 7 0 0 1-7-7V15a7 7 0 0 1 7-7Z",
    art: (
      <>
        <rect x="8" y="8" width="48" height="48" rx="7" fill={HUE_LIGHT} />
        <rect x="16" y="32" width="8" height="16" rx="2.5" fill={HUE_DEEP} />
        <rect x="28" y="22" width="8" height="26" rx="2.5" fill={HUE} />
        <rect x="40" y="15" width="8" height="33" rx="2.5" fill={HUE_DEEP} />
      </>
    ),
  },
  chat: {
    outline: "M16 9h32a9 9 0 0 1 9 9v19a9 9 0 0 1-9 9H31L19 56V46h-3a9 9 0 0 1-9-9V18a9 9 0 0 1 9-9Z",
    art: (
      <>
        <path d="M16 9h32a9 9 0 0 1 9 9v19a9 9 0 0 1-9 9H31L19 56V46h-3a9 9 0 0 1-9-9V18a9 9 0 0 1 9-9Z" fill={HUE} />
        <path d="m32 15.5 2.9 7.1 7.1 2.9-7.1 2.9L32 35.5l-2.9-7.1-7.1-2.9 7.1-2.9Z" fill={PAPER} />
        <circle cx="45" cy="34" r="2.4" fill={PAPER} opacity="0.8" />
      </>
    ),
  },
  pencil: {
    outline: "M41 8 56 23 24 55 8 56l1-16Z",
    art: (
      <>
        <path d="M41 8 56 23 24 55 9 40Z" fill={HUE} />
        <path d="M9 40 24 55 8 56Z" fill={PAPER} />
        <path d="M8 56l.5-7 6.5 6.5Z" fill={INK} />
        <path d="m41 8 15 15-6 6-15-15Z" fill={HUE_DEEP} />
      </>
    ),
  },
  magnifier: {
    outline: "M27 6a21 21 0 0 1 17 33.4L57 52.5 50.5 59 37.4 46A21 21 0 1 1 27 6Z",
    art: (
      <>
        <path d="m38 43 6-6 13 13.5-6.5 6.5Z" fill={HUE_DEEP} />
        <circle cx="27" cy="27" r="21" fill={HUE} />
        <circle cx="27" cy="27" r="13.5" fill={PAPER} />
        <path d="M19 26a8 8 0 0 1 6-7" stroke={HUE_LIGHT} strokeWidth="3" strokeLinecap="round" />
      </>
    ),
  },
  phone: {
    outline: "M24 5h16a7 7 0 0 1 7 7v40a7 7 0 0 1-7 7H24a7 7 0 0 1-7-7V12a7 7 0 0 1 7-7Z",
    art: (
      <>
        <rect x="17" y="5" width="30" height="54" rx="7" fill={HUE} />
        <rect x="21" y="11" width="22" height="38" rx="3" fill={PAPER} />
        <rect x="24.5" y="16" width="15" height="5" rx="2.5" fill={HUE_LIGHT} />
        <rect x="24.5" y="25" width="15" height="5" rx="2.5" fill={HUE_DEEP} />
        <rect x="24.5" y="34" width="9" height="5" rx="2.5" fill={HUE_LIGHT} />
        <circle cx="32" cy="54" r="2" fill={PAPER} />
      </>
    ),
  },
  star: {
    outline: "m32 6 7.6 16.6L58 24.8 44.4 37.2 48 55 32 46 16 55l3.6-17.8L6 24.8l18.4-2.2Z",
    art: (
      <>
        <path d="m32 6 7.6 16.6L58 24.8 44.4 37.2 48 55 32 46 16 55l3.6-17.8L6 24.8l18.4-2.2Z" fill={HUE} />
        <path d="m32 16 4.6 10.2 11 1.3-8.2 7.4 2.2 10.7L32 40.2Z" fill={HUE_LIGHT} opacity="0.7" />
      </>
    ),
  },
  sparkle: {
    outline: "m32 5 6.8 20.2L59 32l-20.2 6.8L32 59l-6.8-20.2L5 32l20.2-6.8Z",
    art: <path d="m32 5 6.8 20.2L59 32l-20.2 6.8L32 59l-6.8-20.2L5 32l20.2-6.8Z" fill={HUE} />,
  },
};

export function Sticker({
  name,
  tilt = -6,
  className,
  style,
}: {
  name: StickerName;
  /** Resting rotation in degrees. */
  tilt?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const { outline, art } = STICKERS[name];
  return (
    <svg
      viewBox="-4 -4 72 72"
      aria-hidden
      className={cn("l-sticker pointer-events-none absolute", className)}
      style={{ "--tilt": `${tilt}deg`, ...style } as CSSProperties}
    >
      <path d={outline} fill={PAPER} stroke={PAPER} strokeWidth="7" strokeLinejoin="round" />
      {art}
    </svg>
  );
}

export type ShapeName = "blob" | "squiggle" | "ring" | "dots" | "plus" | "pill";

const SHAPES: Record<ShapeName, { viewBox: string; art: ReactNode }> = {
  blob: {
    viewBox: "0 0 64 64",
    art: (
      <path
        d="M33 4c12-1 24 7 26 20 2 12-3 27-15 33-11 6-26 3-34-7C2 40 2 24 10 14 16 8 24 5 33 4Z"
        fill="currentColor"
      />
    ),
  },
  squiggle: {
    viewBox: "0 0 96 24",
    art: (
      <path
        d="M4 14c8-12 14-12 22 0s14 12 22 0 14-12 22 0 14 12 22 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    ),
  },
  ring: {
    viewBox: "0 0 64 64",
    art: <circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" strokeWidth="9" />,
  },
  dots: {
    viewBox: "0 0 64 64",
    art: (
      <g fill="currentColor">
        {[8, 24, 40, 56].flatMap((y) => [8, 24, 40, 56].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" />))}
      </g>
    ),
  },
  plus: {
    viewBox: "0 0 64 64",
    art: <path d="M32 10v44M10 32h44" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />,
  },
  pill: {
    viewBox: "0 0 96 40",
    art: <rect x="2" y="2" width="92" height="36" rx="18" fill="currentColor" />,
  },
};

/** An abstract shape; colour it with a text-colour class or `style.color`. */
export function Shape({
  name,
  tilt = 0,
  className,
  style,
}: {
  name: ShapeName;
  tilt?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const { viewBox, art } = SHAPES[name];
  return (
    <svg
      viewBox={viewBox}
      aria-hidden
      className={cn("l-shape pointer-events-none absolute", className)}
      style={{ "--tilt": `${tilt}deg`, ...style } as CSSProperties}
    >
      {art}
    </svg>
  );
}
