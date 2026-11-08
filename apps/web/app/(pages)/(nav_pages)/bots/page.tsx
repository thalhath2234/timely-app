"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { boardOrder, type StarterId } from "@timely/contract/bots";
import { QueryFailure } from "@/app/_components/_ui/loadError";
import { SkeletonCards } from "@/app/_components/_ui/skeleton";
import { useNowMinute } from "@/app/_components/auth/clock";
import { BotsBoard } from "@/app/_components/bots/board";
import {
  BotPanel,
  leaveUnfinished,
  type Unfinished,
} from "@/app/_components/bots/botPanel";
import { BotsEmpty } from "@/app/_components/bots/botsEmpty";
import { BotsHeader } from "@/app/_components/bots/botsHeader";
import { useChatStore } from "@/app/_store/chatStore";
import { useElementSize } from "@/app/_components/report/charts";
import { useBots } from "@/app/utils/hooks/bots";
import { runViewTransition } from "@/app/utils/viewTransition";

/** The chat's context chip when a bot is described from this page. */
const BOTS_CONTEXT = [{ kind: "location", label: "Bots", value: "/bots" }];

/** Content width from which an open bot sits beside a compact board column. */
const SIDE_BY_SIDE = 1000;

/** The `/bots` query string of what is open: a bot, or New bot from a starter; "" for neither. */
function panelHref(bot: string | null, isNew: boolean, starter: string | null) {
  if (bot) return `bot=${encodeURIComponent(bot)}`;
  if (isNew)
    return starter ? `new=1&starter=${encodeURIComponent(starter)}` : "new=1";
  return "";
}

// useSearchParams needs a Suspense boundary for the page to prerender.
export default function BotsRoute() {
  return (
    <Suspense fallback={<SkeletonCards className="m-6" />}>
      <BotsPage />
    </Suspense>
  );
}

function BotsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = useBots();
  const minute = useNowMinute();
  const now = minute === null ? null : new Date(minute * 60_000);

  // What is open lives in the URL, so a notification can open its bot. Clicks
  // set it here first, inside a view transition, and the URL follows.
  const urlPanel = panelHref(
    searchParams.get("bot"),
    searchParams.get("new") === "1",
    searchParams.get("starter"),
  );
  const [panel, setPanel] = useState(urlPanel);
  const [syncedUrlPanel, setSyncedUrlPanel] = useState(urlPanel);
  if (urlPanel !== syncedUrlPanel) {
    // Back/forward or a notification link changed the URL.
    setSyncedUrlPanel(urlPanel);
    setPanel(urlPanel);
  }
  const pushedPanel = useRef(urlPanel);
  useEffect(() => {
    if (panel === syncedUrlPanel) {
      pushedPanel.current = panel;
      return;
    }
    if (panel === pushedPanel.current) return;
    pushedPanel.current = panel;
    router.push(panel ? `/bots?${panel}` : "/bots", { scroll: false });
  }, [panel, syncedUrlPanel, router]);
  const open = new URLSearchParams(panel);
  const selectedId = open.get("bot");
  const isNew = open.get("new") === "1";
  const [bodyRef, bodySize] = useElementSize<HTMLDivElement>();

  const openBot = useCallback(
    (id: string) =>
      runViewTransition(() => setPanel(panelHref(id, false, null))),
    [],
  );
  const openNew = useCallback(
    (starter?: StarterId) =>
      runViewTransition(() => setPanel(panelHref(null, true, starter ?? null))),
    [],
  );
  // A touched New bot draft, or an open bot's unfinished edits, are asked
  // about before a board click replaces them.
  const unfinished = useRef<Unfinished>(null);
  const onUnfinished = useCallback((value: Unfinished) => {
    unfinished.current = value;
  }, []);
  const leaveNew = useCallback(
    (target: string, go: () => void) => {
      if (target === panel) go();
      else leaveUnfinished(unfinished.current, go);
    },
    [panel],
  );
  const pickBot = useCallback(
    (id: string) => leaveNew(panelHref(id, false, null), () => openBot(id)),
    [leaveNew, openBot],
  );
  const pickNew = useCallback(
    (starter?: StarterId) =>
      leaveNew(panelHref(null, true, starter ?? null), () => openNew(starter)),
    [leaveNew, openNew],
  );
  const newBlank = useCallback(() => pickNew(), [pickNew]);
  const closePanel = useCallback(
    () => runViewTransition(() => setPanel("")),
    [],
  );
  const describe = useCallback(
    (text = "") => useChatStore.getState().openNew(BOTS_CONTEXT, text),
    [],
  );

  const list = query.data;
  const panelShown =
    !!list && !!now && (isNew || (!!selectedId && list.bots.length > 0));
  let body;
  if (query.isLoading || !now) body = <SkeletonCards />;
  else if (!list)
    body = (
      <QueryFailure
        what="bots"
        error={query.error}
        hasData={false}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  else if (list.bots.length === 0 && !isNew)
    body = <BotsEmpty onNew={newBlank} onStarter={openNew} onChat={describe} />;
  else {
    const showPanel = !!selectedId || isNew;
    const wide = (bodySize.width || SIDE_BY_SIDE) >= SIDE_BY_SIDE;
    const board = (compact: boolean) => (
      <>
        {query.error ? (
          <QueryFailure
            what="bots"
            error={query.error}
            hasData
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
            className="mb-4"
          />
        ) : null}
        <BotsBoard
          bots={list.bots}
          summary={list.summary}
          now={now}
          selectedId={selectedId}
          compact={compact}
          onOpen={pickBot}
          onNew={newBlank}
          onStarter={pickNew}
        />
      </>
    );
    if (!showPanel) body = board(false);
    else {
      const panelEl = (
        <BotPanel
          key={isNew ? `new-${open.get("starter") ?? ""}` : "edit"}
          mode={isNew ? "new" : "edit"}
          botId={selectedId}
          starter={open.get("starter")}
          listed={list.bots.find((b) => b.id === selectedId)}
          order={boardOrder(list.bots, now)}
          now={now}
          onClose={closePanel}
          onSelect={openBot}
          onUnfinished={onUnfinished}
        />
      );
      // Beside a compact board column when there is room and a board to show;
      // otherwise the panel takes the whole width.
      body =
        wide && list.bots.length > 0 ? (
          <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)] gap-4">
            <div className="min-h-0 overflow-y-auto pb-6 pr-1">
              {board(true)}
            </div>
            <div className="min-h-0 pb-6">{panelEl}</div>
          </div>
        ) : (
          <div className="h-full min-h-0 pb-6">{panelEl}</div>
        );
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <BotsHeader
        list={list}
        now={now}
        onNew={newBlank}
        onDescribe={() => describe()}
      />
      <div
        ref={bodyRef}
        className={
          panelShown
            ? "min-h-0 flex-1 px-6"
            : "min-h-0 flex-1 overflow-y-auto px-6 pb-6"
        }
      >
        {body}
      </div>
    </div>
  );
}
