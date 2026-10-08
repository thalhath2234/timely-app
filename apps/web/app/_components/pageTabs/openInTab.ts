"use client";

import { currentHref, isTabbedPath, usePageTabsStore } from "@/app/_store/pageTabsStore";
import { useToastStore } from "@/app/_store/toastStore";
import { fileIdFromPath, legacyFilePath } from "@/app/utils/fileRoutes";

/**
 * The tab path for a single doc, sheet or sheet template page (the things a
 * tab can hold), or null. Old /docs and /sheets links map to their /files page.
 */
export function pageTabPath(pathname: string) {
  const path = legacyFilePath(pathname) ?? pathname;
  return fileIdFromPath(path) ? path : null;
}

/**
 * Opens `href` in a tab of its own. In the background it only joins the tab
 * strip (a toast offers to show it when the strip is out of sight); otherwise
 * `navigate` shows it right away.
 */
export function openInTab(
  href: string,
  navigate: (href: string) => void,
  { background = true }: { background?: boolean } = {},
) {
  const store = usePageTabsStore.getState();
  store.hydrate();
  const tab = store.tabs.find((item) => currentHref(item) === href) ?? store.open(href, { activate: false });

  const show = () => {
    usePageTabsStore.getState().activate(tab.id);
    navigate(href);
  };

  if (!background) return show();
  if (isTabbedPath(window.location.pathname)) return;
  useToastStore.getState().show("Opened in a new tab", { label: "Show", onAction: show });
}
