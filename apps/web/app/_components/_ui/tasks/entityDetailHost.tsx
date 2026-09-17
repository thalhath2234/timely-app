"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import EntityDetailPanel from "@/app/_components/_ui/tasks/entityDetailPanel";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { isTasksListPath, parseTasksEntityHref } from "@/app/utils/entityDetail";

export default function EntityDetailHost() {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const kind = useEntityDetailStore((state) => state.kind);
  const id = useEntityDetailStore((state) => state.id);
  const closeEntity = useEntityDetailStore((state) => state.closeEntity);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    closeEntity();
  }, [pathname, closeEntity]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (isTasksListPath(window.location.pathname)) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      if (!anchor) return;
      if (anchor.getAttribute("target") === "_blank") return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      const entity = parseTasksEntityHref(href);
      if (!entity) return;

      // Window capture runs before Next.js's document listener, so a
      // `/tasks?taskId=` chip can open in place instead of changing route.
      event.preventDefault();
      event.stopPropagation();
      useEntityDetailStore.getState().openEntity(entity.kind, entity.id);
    };

    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  return isTasksListPath(pathname) || !kind || !id ? null : (
    <EntityDetailPanel key={`${kind}:${id}`} kind={kind} id={id} onClose={closeEntity} />
  );
}
