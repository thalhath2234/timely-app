import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Chapter } from "@/app/_components/film/chapters";
import { Reveal } from "./reveal";
import { ScenePlayer } from "./scenePlayer";

/** One chapter of the page: the copy on the left, its looping scene on the right. */
export default function ChapterSection({ chapter }: { chapter: Chapter }) {
  return (
    <section id={chapter.id} className="grid scroll-mt-20 gap-8 border-t border-[var(--s-line)] py-14 lg:grid-cols-12 lg:gap-12 lg:py-20">
      <Reveal className="lg:col-span-5 lg:self-center">
        <p className="flex items-center gap-3 text-sm">
          <span className="s-mono" style={{ color: chapter.color }}>
            {chapter.n}
          </span>
          <span className="font-medium text-[var(--s-soft)]">{chapter.title}</span>
        </p>
        <h2 className="s-display mt-4 text-[2rem] sm:text-[2.6rem] lg:text-[2.9rem]">{chapter.headline}</h2>
        <p className="s-soft mt-5 max-w-[52ch] text-base leading-relaxed sm:text-[1.0625rem]">{chapter.body}</p>
        <ul className="mt-6 grid gap-2.5 text-sm">
          {chapter.facts.map((fact) => (
            <li key={fact} className="flex items-center gap-3">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: chapter.color }} />
              {fact}
            </li>
          ))}
        </ul>
        <Link href={chapter.help} className="group mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--s-primary)]">
          Read in the help center
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </Reveal>
      <Reveal className="lg:col-span-7">
        <div className="s-scene">
          <ScenePlayer id={chapter.id} frames={chapter.frames} label={`${chapter.title}: ${chapter.headline}`} />
        </div>
      </Reveal>
    </section>
  );
}
