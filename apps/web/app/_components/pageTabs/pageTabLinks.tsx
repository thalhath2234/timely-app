"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { docsKey } from "@/app/utils/hooks/docs";
import { wikiLinkPage } from "@/app/_components/editor/wikiLink";
import { isPageTabHref, openInTab } from "@/app/_components/pageTabs/openInTab";
import type { Doc } from "@/app/_types/types";

/**
 * Ctrl/Cmd-click or middle-click on any link to a doc or sheet (lists, mention
 * chips, wiki links, breadcrumbs, agent change cards) opens it in a background
 * tab instead of a browser tab or, in the desktop app, a new window. Adding
 * Shift opens the tab and switches to it.
 */
export default function PageTabLinks() {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    const pageHref = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      const anchor = target.closest("a[href]");
      if (!anchor) return null;

      if (anchor.hasAttribute("data-wiki-link")) {
        const wanted = wikiLinkPage(anchor.getAttribute("data-target") ?? "").toLowerCase();
        const doc = queryClient
          .getQueryData<Doc[]>(docsKey)
          ?.find((item) => item.title.trim().toLowerCase() === wanted);
        return doc ? `/docs/${doc.id}` : null;
      }

      let url: URL;
      try {
        url = new URL(anchor.getAttribute("href") ?? "", window.location.href);
      } catch {
        return null;
      }
      if (url.origin !== window.location.origin) return null;
      return isPageTabHref(url.pathname) ? url.pathname : null;
    };

    const open = (event: MouseEvent, href: string) => {
      event.preventDefault();
      event.stopPropagation();
      openInTab(href, (next) => router.push(next), { background: !event.shiftKey });
    };

    // Capture on window runs before Next's <Link> and the editor's own
    // click handlers, so neither sees a click that opened a tab.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const href = pageHref(event);
      if (href) open(event, href);
    };
    const onAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return;
      const href = pageHref(event);
      if (href) open(event, href);
    };
    // A middle press would otherwise start autoscroll, or paste on Linux.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1 && pageHref(event)) event.preventDefault();
    };

    window.addEventListener("click", onClick, true);
    window.addEventListener("auxclick", onAuxClick, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("auxclick", onAuxClick, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [queryClient, router]);

  return null;
}
