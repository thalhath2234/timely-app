"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Menu, Search, X } from "lucide-react";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { GitHubMark } from "@/app/_components/site/marks";
import { ACCOUNT, BASE, NAV } from "./data";
import SitePalette from "./palette";
import { useModKey } from "./platformKey";

/** Top bar: logo, sections, a Ctrl/Cmd+K jump box, account links. Phones get a command-list menu. */
export default function Header() {
  const mod = useModKey();
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMenu(false);
        setPalette((value) => !value);
      } else if (event.key === "Escape") {
        setMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="d3-header">
      <div className="d3-wrap d3-header-row">
        <Link href={BASE} className="d3-brand" aria-label="Timely home">
          <TimelyLogo size={24} />
          <span>Timely</span>
        </Link>

        <nav aria-label="Main" className="d3-nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="d3-nav-link"
              aria-current={item.href === pathname ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <button type="button" className="d3-jump" onClick={() => setPalette(true)} aria-haspopup="dialog">
          <Search aria-hidden className="d3-jump-ico" />
          <span>Jump to</span>
          <span className="d3-keys" aria-hidden>
            <kbd className="d3-key" data-size="sm">{mod}</kbd>
            <kbd className="d3-key" data-size="sm">K</kbd>
          </span>
        </button>

        <div className="d3-header-actions">
          <a href={ACCOUNT.github} className="d3-icon-btn" aria-label="Timely on GitHub">
            <GitHubMark className="d3-gh" />
          </a>
          <Link href={ACCOUNT.login} className="d3-btn d3-btn-ghost d3-btn-sm">
            Log in
          </Link>
          <Link href={ACCOUNT.register} className="d3-btn d3-btn-amber d3-btn-sm">
            Register
          </Link>
        </div>

        <button
          type="button"
          className="d3-menu-btn"
          aria-expanded={menu}
          aria-controls="d3-menu"
          onClick={() => setMenu((value) => !value)}
        >
          {menu ? <X aria-hidden className="d3-jump-ico" /> : <Menu aria-hidden className="d3-jump-ico" />}
          <span>Menu</span>
        </button>
      </div>

      <AnimatePresence>
        {menu ? (
          <motion.div
            id="d3-menu"
            className="d3-menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            <nav aria-label="Menu" className="d3-wrap">
              <ul className="d3-menu-list">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="d3-menu-link" onClick={() => setMenu(false)}>
                      <span className="d3-prompt" aria-hidden>
                        ›
                      </span>
                      {item.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <a href={ACCOUNT.github} className="d3-menu-link">
                    <span className="d3-prompt" aria-hidden>
                      ›
                    </span>
                    GitHub
                  </a>
                </li>
              </ul>
              <div className="d3-menu-actions">
                <Link href={ACCOUNT.login} className="d3-btn d3-btn-ghost">
                  Log in
                </Link>
                <Link href={ACCOUNT.register} className="d3-btn d3-btn-amber">
                  Register
                </Link>
              </div>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <SitePalette open={palette} onClose={() => setPalette(false)} />
    </header>
  );
}
