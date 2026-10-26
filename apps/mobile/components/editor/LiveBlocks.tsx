import { useEffect, useMemo, useRef } from "react";
import type { GenuiNode } from "@timely/contract/genui";
import { cellsProblems, drawBoard, liveBlockCards } from "@timely/contract/genuiBoard";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { useDashboardData, useNow } from "../../lib/dashboard";
import { liveBlockHtml, type LiveTask } from "./liveBlockHtml";

export type LiveDrawing = { program: string; html: string; title: string };

/**
 * Draws a doc's live blocks for the editor page. Each program's @Data and
 * @Cells calls read the app's own data, as described cards on the Dashboard do, so a tick
 * or a refresh draws the blocks again and the AI is never asked. Shows
 * nothing itself: the page puts the drawings in place (editorHtml.ts).
 */
export default function LiveBlocks({
  programs,
  onDrawn,
}: {
  /** The doc's programs in order, as the page reported them. */
  programs: string[];
  onDrawn: (blocks: LiveDrawing[]) => void;
}) {
  const cards = useMemo(() => liveBlockCards(programs), [programs]);
  const { data, timeZone, loading, eventsLoading, sheetsLoading } = useDashboardData(cards);
  const now = useNow(60_000);

  const blocks = useMemo(() => {
    if (loading || eventsLoading || sheetsLoading) return null;
    // Ticks show the task as it is now, as the Dashboard's rows do (genui/kit.tsx).
    const today = todayInZone();
    const tasks = new Map<string, LiveTask>();
    for (const task of [...(data.tasks ?? []), ...(data.reminders ?? [])]) {
      tasks.set(task.id, { title: task.name, done: Boolean(task.completedAt), late: isOverdue(task, today) });
    }
    const seen = new Set<string>();
    return programs.flatMap((program) => {
      const key = program.trim();
      if (!key || seen.has(key)) return [];
      seen.add(key);
      let root: GenuiNode | null = null;
      try {
        root = drawBoard(program, data, { now, timeZone });
      } catch {
        root = null;
      }
      const title = typeof root?.props.title === "string" ? root.props.title.trim() : "";
      return [{ program: key, html: liveBlockHtml(root, (id) => tasks.get(id), cellsProblems(program, data)[0]), title }];
    });
  }, [programs, data, now, timeZone, loading, eventsLoading, sheetsLoading]);

  // A new page reports its programs again (a new array), so it gets the drawings too.
  const payload = blocks ? JSON.stringify(blocks) : null;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  useEffect(() => {
    if (payload) onDrawnRef.current(JSON.parse(payload) as LiveDrawing[]);
  }, [payload, programs]);
  return null;
}
