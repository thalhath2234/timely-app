import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";
import { hueStyle } from "./hue";
import { Shape, Sticker, type ShapeName, type StickerName } from "./stickers";

export type StageShape = {
  name: ShapeName;
  /** Entity colour the shape is tinted from. */
  hue: string;
  /** Size and position utilities. */
  className: string;
  tilt?: number;
};

/** The pastel panel a scene sits on, with its sticker and loose shapes around it. */
export function Stage({
  sticker,
  stickerSide = "right",
  shapes = [],
  children,
}: {
  sticker: StickerName;
  /** The top corner the sticker overlaps. */
  stickerSide?: "left" | "right";
  shapes?: StageShape[];
  children: ReactNode;
}) {
  return (
    <div className="relative mx-auto w-full max-w-[34rem]">
      {shapes.map((shape) => (
        <Shape
          key={`${shape.name}-${shape.className}`}
          name={shape.name}
          tilt={shape.tilt}
          className={shape.className}
          style={hueStyle(shape.hue)}
        />
      ))}
      <div className="l-stage relative rounded-[1.75rem] p-4 sm:rounded-[2.5rem] sm:p-7">{children}</div>
      <Sticker
        name={sticker}
        tilt={stickerSide === "left" ? -9 : 8}
        className={cn(
          "-top-7 size-16 sm:-top-9 sm:size-20",
          stickerSide === "left" ? "-left-3 sm:-left-6" : "-right-3 sm:-right-6",
        )}
      />
    </div>
  );
}

/** One feature: a domain-term label, a plain headline, and a scene on its stage. */
export function Section({
  id,
  hue,
  label,
  step,
  headline,
  body,
  points = [],
  extra,
  flip = false,
  sticker,
  shapes,
  children,
}: {
  id: string;
  hue: string;
  label: string;
  /** Position in the five-step loop, when the section is one of its steps. */
  step?: number;
  headline: string;
  body: ReactNode;
  points?: string[];
  extra?: ReactNode;
  /** Put the scene, and its sticker, on the left at desktop widths. */
  flip?: boolean;
  sticker: StickerName;
  shapes?: StageShape[];
  children: ReactNode;
}) {
  return (
    <section id={id} className="l-hue relative overflow-x-clip" style={hueStyle(hue)}>
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <div className={cn("max-w-xl", flip && "lg:order-2")}>
          <p className="l-label inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide">
            {step ? <span className="font-mono tabular-nums">{`0${step}`}</span> : null}
            {label}
          </p>
          <h2 className="l-display mt-4 text-3xl leading-[1.08] font-bold text-balance sm:text-4xl lg:text-[2.75rem]">
            {headline}
          </h2>
          <p className="l-soft mt-4 text-base leading-relaxed sm:text-lg">{body}</p>
          {points.length > 0 ? (
            <ul className="mt-5 space-y-2.5 text-sm sm:text-[0.9375rem]">
              {points.map((point) => (
                <li key={point} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-[0.45em] size-2 shrink-0 rounded-full"
                    style={{ background: "var(--l-hue-ink)" }}
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {extra}
        </div>
        <Stage sticker={sticker} stickerSide={flip ? "left" : "right"} shapes={shapes}>
          {children}
        </Stage>
      </div>
    </section>
  );
}
