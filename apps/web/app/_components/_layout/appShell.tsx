"use client";

import { useEffect, useRef, useState } from "react";
import Sidebar from "@/app/_components/_layout/sidebar";
import { usePreferences } from "@/app/_components/_layout/clientRuntime";
import { useContextMenuStore } from "@/app/_store/contextMenuStore";
import { cn } from "@/app/utils/cn";

const EDGE_WIDTH = 12;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { sidebarAutoHide } = usePreferences();
  const menuOpen = useContextMenuStore((state) => state.menu != null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!sidebarAutoHide) setRevealed(false);
  }, [sidebarAutoHide]);

  const autoHide = ready && sidebarAutoHide;

  useEffect(() => {
    if (!autoHide) return;

    function onPointerMove(event: PointerEvent) {
      const target = event.target;
      const overSidebar = target instanceof Node && (sidebarRef.current?.contains(target) ?? false);
      const next = event.clientX <= EDGE_WIDTH || overSidebar;
      setRevealed((current) => (current === next ? current : next));
    }

    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [autoHide]);

  const showSidebar = !autoHide || revealed || menuOpen;

  return (
    <div className="relative flex h-full w-full flex-row overflow-hidden bg-sidebar">
      {autoHide ? (
        <div
          aria-hidden
          data-sidebar-hover-edge=""
          className="absolute inset-y-0 left-0 z-40"
          style={{ width: EDGE_WIDTH }}
          onPointerEnter={() => setRevealed(true)}
          onPointerDown={() => setRevealed(true)}
        />
      ) : null}

      <div
        ref={sidebarRef}
        className={cn(
          "flex h-full w-[68px] items-center justify-center border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
          autoHide
            ? "absolute inset-y-0 left-0 z-50 shadow-xl transition-transform duration-200 ease-out"
            : "shrink-0",
          autoHide && !showSidebar && "-translate-x-full pointer-events-none",
        )}
        onFocusCapture={() => {
          if (autoHide) setRevealed(true);
        }}
        onBlurCapture={(event) => {
          if (!autoHide) return;
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setRevealed(false);
          }
        }}
        aria-hidden={autoHide && !showSidebar}
        inert={autoHide && !showSidebar ? true : undefined}
      >
        <Sidebar />
      </div>

      <div
        id="main-content"
        className="m-1 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-sm"
      >
        {children}
      </div>
    </div>
  );
}
