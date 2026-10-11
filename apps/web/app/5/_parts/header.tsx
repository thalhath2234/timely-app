"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { Menu, X } from "lucide-react";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { Ring } from "./ring";

const BASE = "/5";

const NAV = [
  { href: `${BASE}#ai`, label: "AI" },
  { href: `${BASE}#how-it-works`, label: "How it works" },
  { href: `${BASE}#docs-and-sheets`, label: "Docs and sheets" },
  { href: `${BASE}#download`, label: "Download" },
  { href: `${BASE}/help`, label: "Help" },
];

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <TimelyLogo size={26} tone="mono" className="text-[var(--mint)]" />
      <span className="text-[21px] font-semibold tracking-[-0.02em]">Timely</span>
    </span>
  );
}

/**
 * The page reads like one Pomodoro cycle. On wide screens the header shows
 * where you are in it: the ring follows the scroll, the label the section.
 */
function SessionMeter() {
  const { scrollYProgress } = useScroll();
  const [label, setLabel] = useState("");

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-phase]"));
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setLabel((entry.target as HTMLElement).dataset.phase ?? "");
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  if (!label) return null;
  return (
    <span className="hdr-session" aria-hidden>
      <Ring progress={scrollYProgress} size={22} stroke={10} />
      <span className="num">{label}</span>
    </span>
  );
}

export default function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 8));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="hdr" data-scrolled={scrolled || open}>
      <div className="wrap hdr-row">
        <Link href={BASE} aria-label="Timely, design 5 home" className="inline-flex min-h-11 items-center">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="hdr-nav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hdr-end">
          <a href={REPO_URL} className="btn btn-quiet btn-sm" aria-label="Timely on GitHub">
            <GitHubMark className="size-[18px]" />
          </a>
          <Link href="/login" className="btn btn-quiet btn-sm">
            Log in
          </Link>
          <Link href="/signup" className="btn btn-mint btn-sm">
            Register
          </Link>
          <SessionMeter />
        </div>
        <button
          type="button"
          className="hdr-menu-btn"
          aria-expanded={open}
          aria-controls="d5-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id="d5-menu"
            className="hdr-sheet"
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <nav aria-label="Main" className="wrap pt-2 pb-6">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              ))}
              <a href={REPO_URL} onClick={() => setOpen(false)} className="gap-3">
                <GitHubMark className="size-[18px]" />
                GitHub
              </a>
              <div className="mt-5 flex gap-2.5">
                <Link href="/login" className="btn btn-line flex-1" onClick={() => setOpen(false)}>
                  Log in
                </Link>
                <Link href="/signup" className="btn btn-mint flex-1" onClick={() => setOpen(false)}>
                  Register
                </Link>
              </div>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
