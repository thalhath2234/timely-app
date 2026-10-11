"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, CornerDownLeft, Hash, LogIn, Search, UserPlus } from "lucide-react";
import { ISSUES_URL, LATEST_RELEASE_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { ACCOUNT, BASE, PLATFORMS } from "./data";

type Command = { id: string; label: string; group: string; href: string; hint: string; external?: boolean; icon?: "hash" | "out" | "in" | "up" | "gh" };

const COMMANDS: Command[] = [
  { id: "ai", label: "AI: use your Claude or ChatGPT plan", group: "On this page", href: `${BASE}#ai`, hint: "section", icon: "hash" },
  { id: "how", label: "How it works: capture, clarify, schedule, focus", group: "On this page", href: `${BASE}#how-it-works`, hint: "section", icon: "hash" },
  { id: "docs", label: "Docs and sheets", group: "On this page", href: `${BASE}#docs-and-sheets`, hint: "section", icon: "hash" },
  { id: "download", label: "Download", group: "On this page", href: `${BASE}#download`, hint: "section", icon: "hash" },
  { id: "register", label: "Register", group: "Account", href: ACCOUNT.register, hint: "account", icon: "up" },
  { id: "login", label: "Log in", group: "Account", href: ACCOUNT.login, hint: "account", icon: "in" },
  { id: "help", label: "Help center", group: "Help", href: `${BASE}/help`, hint: "page" },
  { id: "shortcuts", label: "Keyboard shortcuts", group: "Help", href: "/help/start/shortcuts", hint: "article" },
  { id: "mcp", label: "Connect an agent with MCP", group: "Help", href: "/help/assistant/mcp", hint: "article" },
  ...PLATFORMS.map((platform) => ({
    id: `get-${platform.id}`,
    label: `Install on ${platform.name}`,
    group: "Help",
    href: platform.guide,
    hint: "guide",
  })),
  { id: "github", label: "Source code on GitHub", group: "Links", href: ACCOUNT.github, hint: "github.com", external: true, icon: "gh" },
  { id: "release", label: "Latest release", group: "Links", href: LATEST_RELEASE_URL, hint: "github.com", external: true, icon: "out" },
  { id: "issues", label: "Report an issue", group: "Links", href: ISSUES_URL, hint: "github.com", external: true, icon: "out" },
];

function match(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return COMMANDS;
  return COMMANDS.filter((command) => words.every((word) => `${command.label} ${command.group} ${command.hint}`.toLowerCase().includes(word)));
}

function Icon({ icon }: { icon?: Command["icon"] }) {
  if (icon === "hash") return <Hash aria-hidden className="d3-pal-ico" />;
  if (icon === "gh") return <GitHubMark className="d3-pal-ico" />;
  if (icon === "out") return <ArrowUpRight aria-hidden className="d3-pal-ico" />;
  if (icon === "in") return <LogIn aria-hidden className="d3-pal-ico" />;
  if (icon === "up") return <UserPlus aria-hidden className="d3-pal-ico" />;
  return <CornerDownLeft aria-hidden className="d3-pal-ico" />;
}

/** The page's own Ctrl/Cmd+K: jump to a section, a help article, or an account page. */
export default function SitePalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => match(query), [query]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previous?.focus?.();
    };
  }, [open]);

  const run = (command: Command) => {
    onClose();
    setQuery("");
    setActive(0);
    if (command.external) window.location.href = command.href;
    else router.push(command.href);
  };

  let lastGroup = "";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="d3-pal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Jump to"
            className="d3-pal"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "Tab") {
                event.preventDefault();
                inputRef.current?.focus();
              }
            }}
          >
            <div className="d3-pal-input">
              <Search aria-hidden className="d3-pal-ico" />
              <span className="d3-prompt" aria-hidden>
                ›
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((value) => Math.min(value + 1, results.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((value) => Math.max(value - 1, 0));
                  } else if (event.key === "Enter" && results[active]) {
                    event.preventDefault();
                    run(results[active]);
                  }
                }}
                placeholder="Type a command or a page"
                aria-label="Type a command or a page"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
                spellCheck={false}
                autoComplete="off"
              />
              <kbd className="d3-key" data-size="sm">
                Esc
              </kbd>
            </div>
            <ul id={listId} role="listbox" aria-label="Commands" className="d3-pal-list">
              {results.length ? (
                results.map((command, index) => {
                  const showGroup = command.group !== lastGroup;
                  lastGroup = command.group;
                  return (
                    <li key={command.id} role="presentation">
                      {showGroup ? (
                        <p className="d3-pal-group" aria-hidden>
                          {command.group}
                        </p>
                      ) : null}
                      <div
                        id={`${listId}-${command.id}`}
                        role="option"
                        aria-selected={index === active}
                        className="d3-pal-row"
                        onMouseMove={() => setActive(index)}
                        onClick={() => run(command)}
                      >
                        <Icon icon={command.icon} />
                        <span className="d3-pal-label">{command.label}</span>
                        <span className="d3-pal-hint">{command.hint}</span>
                      </div>
                    </li>
                  );
                })
              ) : (
                <li className="d3-pal-empty">No command matches &ldquo;{query}&rdquo;.</li>
              )}
            </ul>
            <p className="d3-pal-foot" aria-hidden>
              <span>
                <kbd className="d3-key" data-size="sm">↑</kbd>
                <kbd className="d3-key" data-size="sm">↓</kbd> move
              </span>
              <span>
                <kbd className="d3-key" data-size="sm">↵</kbd> open
              </span>
              <span>
                <kbd className="d3-key" data-size="sm">Esc</kbd> close
              </span>
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
