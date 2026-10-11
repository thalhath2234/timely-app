import Image from "next/image";
import LoopColumns from "./loopFigures";
import { Caption, ChapterHead, Footnotes, Page, Rv } from "./ui";

/** A real screenshot, tipped into the manual with photo corners. */
export function Plate({
  src,
  alt,
  fig,
  caption,
  className,
  sizes = "(min-width: 1024px) 760px, 100vw",
  tilt = 0,
}: {
  src: string;
  alt: string;
  fig: string;
  caption: React.ReactNode;
  className?: string;
  sizes?: string;
  tilt?: number;
}) {
  return (
    <figure className={className}>
      <div className="d2-plate" style={tilt ? { rotate: `${tilt}deg` } : undefined}>
        <span className="d2-corner-b" aria-hidden />
        <Image src={src} alt={alt} width={1920} height={1200} sizes={sizes} className="block h-auto w-full" />
      </div>
      <Caption fig={fig} className="mt-4">
        {caption}
      </Caption>
    </figure>
  );
}

/** Chapter 2: Capture, Clarify, Auto-schedule, Focus. */
export default function ChapterLoop() {
  return (
    <section id="how-it-works" aria-labelledby="loop-title" className="border-t border-[var(--rule-2)] bg-[var(--paper-2)] py-20 sm:py-28">
      <Page>
        <ChapterHead
          n={2}
          head="How it works"
          headingId="loop-title"
          title="One loop, from the first thought to done."
          lead="Timely is built around four steps. You decide what matters and how long it takes; Timely does the arranging."
        />
        <LoopColumns />
        <Rv className="mt-20 grid items-end gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Plate
            src="/help/calendar.webp"
            alt="Timely's week calendar for 11 to 17 October 2026: work blocks placed around events, with 14 items waiting for a slot on the right."
            fig="2.5"
            caption="The week of 11 October after Auto-schedule: 33 on the calendar, 14 still waiting for a slot."
            tilt={-0.6}
          />
          <div className="lg:pb-14">
            <p className="d2-hand -rotate-2 text-[1.7rem] leading-tight text-[var(--verm-2)]">a meeting moved?</p>
            <p className="d2-soft mt-3 max-w-[38ch] leading-relaxed">
              When a new meeting lands on top of planned Work, the next run moves what it overlaps. Pinned and manual
              blocks stay where you put them.
            </p>
          </div>
        </Rv>
        <Footnotes running="How it works" folio={16} notes={[]} />
      </Page>
    </section>
  );
}
