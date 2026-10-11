"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { HelpSection } from "@/app/_components/help/types";
import { NOTE, Tape, type NoteColor } from "./paper";
import { drop } from "./motionKit";

export const SECTION_COLORS: Record<string, NoteColor> = {
  start: "yellow",
  install: "blue",
  plan: "green",
  organize: "orange",
  notes: "violet",
  assistant: "pink",
  account: "cream",
};

const TILTS = [-1.2, 0.9, -0.6, 1.3, -1, 0.7, -0.8];

type Folder = Pick<HelpSection, "id" | "title" | "description"> & {
  articles: { title: string; summary: string; href: string }[];
};

/** Every help topic as a coloured folder: a tab with the topic, its articles inside. */
export function FolderBoard({
  folders,
  icons,
  extra,
}: {
  folders: Folder[];
  icons: Record<string, React.ReactNode>;
  extra?: React.ReactNode;
}) {
  return (
    <ul className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {folders.map((folder, index) => {
        const color = NOTE[SECTION_COLORS[folder.id] ?? "cream"];
        return (
          <motion.li
            key={folder.id}
            id={folder.id}
            initial={{ y: -28, rotate: TILTS[index % TILTS.length] * 3 }}
            whileInView={{ y: 0, rotate: TILTS[index % TILTS.length] }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ ...drop, delay: (index % 3) * 0.08 }}
            className="relative pt-9"
          >
            {/* Folder tab */}
            <span
              className="absolute top-0 left-0 flex h-10 max-w-[85%] items-center gap-2 rounded-t-lg pr-5 pl-3.5 text-[var(--paper-ink)]"
              style={{ background: color }}
            >
              {icons[folder.id]}
              <span className="d6-display truncate text-[0.95rem] font-extrabold">{folder.title}</span>
            </span>
            <article
              aria-labelledby={`${folder.id}-heading`}
              className="relative rounded-tr-lg rounded-b-lg p-5 text-[var(--paper-ink)] shadow-[0_1px_1px_rgb(0_0_0/0.35),0_18px_30px_-16px_rgb(0_0_0/0.85)]"
              style={{
                background: color,
                backgroundImage: "linear-gradient(180deg, rgb(255 255 255 / 18%), rgb(255 255 255 / 0%) 40%)",
              }}
            >
              <h3 id={`${folder.id}-heading`} className="sr-only">
                {folder.title}
              </h3>
              <p className="text-[0.95rem] leading-snug font-medium text-[var(--paper-soft)]">{folder.description}</p>
              <ul className="mt-3 rounded-md bg-[#fbf7ee] px-1.5 py-1 shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)]">
                {folder.articles.map((article) => (
                  <li key={article.href} className="border-b border-black/[0.08] last:border-b-0">
                    <Link
                      href={article.href}
                      className="group flex min-h-11 items-center gap-2 rounded-[4px] px-2.5 py-2 text-[0.97rem] font-semibold transition-colors hover:bg-black/[0.05]"
                    >
                      <span className="min-w-0 flex-1">{article.title}</span>
                      <ArrowRight className="size-4 shrink-0 opacity-40 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="d6-mono mt-3 text-[0.75rem] font-semibold text-[var(--paper-soft)]">
                {folder.articles.length} articles
              </p>
            </article>
          </motion.li>
        );
      })}
      {extra ? (
        <motion.li
          initial={{ y: -28, rotate: -3 }}
          whileInView={{ y: 0, rotate: -1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ ...drop, delay: 0.1 }}
          className="relative flex items-center pt-9 lg:col-span-2"
        >
          {extra}
        </motion.li>
      ) : null}
    </ul>
  );
}

/** Notes that drop onto the desk one after another when the page opens. */
export function DroppedNote({
  children,
  color,
  rotate,
  delay = 0,
  className,
  tape = false,
}: {
  children: React.ReactNode;
  color: NoteColor;
  rotate: number;
  delay?: number;
  className?: string;
  tape?: boolean;
}) {
  return (
    <motion.div
      initial={{ y: -40, rotate: rotate * 3, scale: 1.06 }}
      animate={{ y: 0, rotate, scale: 1 }}
      transition={{ ...drop, delay }}
      className={`d6-note relative ${className ?? ""}`}
      style={{ ["--c" as string]: NOTE[color] }}
    >
      {tape ? <Tape className="-top-3 left-1/2 -translate-x-1/2 rotate-[-4deg]" /> : null}
      {children}
    </motion.div>
  );
}
