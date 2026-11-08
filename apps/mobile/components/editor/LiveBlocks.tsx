import { useEffect, useMemo, useRef } from "react";
import { useWindowDimensions } from "react-native";
import { useQueries } from "@tanstack/react-query";
import { checklistItems, type DocChecklistItem } from "@timely/contract/docChecklist";
import type { GenuiNode } from "@timely/contract/genui";
import { drawBoard, drawProblems, liveBlockCards, liveBotIds } from "@timely/contract/genuiBoard";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { getBot } from "../../lib/api/bots";
import { ApiError } from "../../lib/api/client";
import { useDashboardData, useNow } from "../../lib/dashboard";
import { botPoll, keys } from "../../lib/hooks";
import { liveBlockHtml, type LiveBot, type LiveTask } from "./liveBlockHtml";

/** A live block's side padding: a price chart is this much narrower than the block, on each side. */
const BLOCK_PAD = 14;

export type LiveDrawing = { program: string; html: string; title: string };

/**
 * Draws a doc's live blocks for the editor page. Each program's @Data,
 * @Cells and @Checklist calls read the app's own data, as described cards on
 * the Dashboard do, so a tick or a refresh draws the blocks again and the AI
 * is never asked. Shows nothing itself: the page puts the drawings in place
 * (editorHtml.ts).
 */
export default function LiveBlocks({
  programs,
  width,
  onDrawn,
}: {
  /** The doc's programs in order, as the page reported them. */
  programs: string[];
  /** A block's width in the editor, once measured. */
  width?: number;
  onDrawn: (blocks: LiveDrawing[]) => void;
}) {
  const cards = useMemo(() => liveBlockCards(programs), [programs]);
  const { data, timeZone, loading, eventsLoading, sheetsLoading } = useDashboardData(cards);
  const now = useNow(60_000);
  const screen = useWindowDimensions();
  const chartWidth = Math.floor((width && width > 0 ? width : screen.width - 32) - 2 * BLOCK_PAD);

  // Price blocks read their bots by id only; a name or a reserved word is never fetched.
  const botIds = useMemo(() => liveBotIds(programs), [programs]);
  const botQueries = useQueries({
    queries: botIds.map((id) => ({
      queryKey: keys.bot(id),
      queryFn: () => getBot(id),
      staleTime: 60_000,
      // Read again as the bot sheet does, so an open doc's block follows new checks.
      refetchInterval: botPoll,
      // A deleted bot stays missing: asking again only adds a request.
      retry: (count: number, error: Error) => !(error instanceof ApiError && error.status === 404) && count < 1,
    })),
  });
  const botsLoading = botQueries.some((query) => query.isPending);
  // Changes whenever a bot is read again, so a new check redraws its block.
  const botKey = botQueries.map((query) => `${query.status}:${query.dataUpdatedAt}:${query.errorUpdatedAt}`).join();

  const blocks = useMemo(() => {
    if (loading || eventsLoading || sheetsLoading || botsLoading) return null;
    const bots = new Map<string, LiveBot>();
    botIds.forEach((id, index) => {
      const query = botQueries[index];
      // A bot deleted while the doc was open says so, even with its old copy cached.
      if (query?.error instanceof ApiError && query.error.status === 404) bots.set(id, { state: "gone" });
      else if (query?.data) bots.set(id, { state: "ok", detail: query.data });
      else bots.set(id, { state: query?.isPending ? "loading" : "failed" });
    });
    // Ticks show the task or item as it is now, as the Dashboard's rows do (genui/kit.tsx).
    const today = todayInZone();
    const tasks = new Map<string, LiveTask>();
    for (const task of [...(data.tasks ?? []), ...(data.reminders ?? [])]) {
      tasks.set(task.id, { title: task.name, done: Boolean(task.completedAt), late: isOverdue(task, today) });
    }
    // A doc's checklist is read when a row asks for it, once per doc.
    const checklists = new Map<string, DocChecklistItem[] | undefined>();
    const live = {
      task: (id: string) => tasks.get(id),
      checklist: (id: string) => {
        if (!checklists.has(id)) {
          const doc = data.docs?.find((item) => item.id === id);
          // An archived doc offers no ticks (the API refuses them).
          checklists.set(id, doc ? (doc.archivedAt ? [] : checklistItems(doc.content)) : undefined);
        }
        return checklists.get(id);
      },
      bot: (id: string): LiveBot => bots.get(id) ?? { state: "invalid" },
      chartWidth,
    };
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
      return [{ program: key, html: liveBlockHtml(root, live, drawProblems(program, data)[0]), title }];
    });
    // botKey stands in for botQueries, a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programs, data, now, timeZone, loading, eventsLoading, sheetsLoading, botsLoading, botIds, botKey, chartWidth]);

  // A new page reports its programs again (a new array), so it gets the drawings too.
  const payload = blocks ? JSON.stringify(blocks) : null;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  useEffect(() => {
    if (payload) onDrawnRef.current(JSON.parse(payload) as LiveDrawing[]);
  }, [payload, programs]);
  return null;
}
