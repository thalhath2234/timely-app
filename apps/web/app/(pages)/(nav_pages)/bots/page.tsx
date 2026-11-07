"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { StarterId } from "@timely/contract/bots";
import { QueryFailure } from "@/app/_components/_ui/loadError";
import { SkeletonCards } from "@/app/_components/_ui/skeleton";
import { useNowMinute } from "@/app/_components/auth/clock";
import { BotsBoard } from "@/app/_components/bots/board";
import { BotsEmpty } from "@/app/_components/bots/botsEmpty";
import { BotsHeader } from "@/app/_components/bots/botsHeader";
import { useChatStore } from "@/app/_store/chatStore";
import { useBots } from "@/app/utils/hooks/bots";
import { runViewTransition } from "@/app/utils/viewTransition";

/** The chat's context chip when a bot is described from this page. */
const BOTS_CONTEXT = [{ kind: "location", label: "Bots", value: "/bots" }];

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
  const selectedId = new URLSearchParams(panel).get("bot");

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
  const newBlank = useCallback(() => openNew(), [openNew]);
  const describe = useCallback(
    (text = "") => useChatStore.getState().openNew(BOTS_CONTEXT, text),
    [],
  );

  const list = query.data;
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
  else if (list.bots.length === 0)
    body = <BotsEmpty onNew={newBlank} onStarter={openNew} onChat={describe} />;
  else
    body = (
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
          now={now}
          selectedId={selectedId}
          onOpen={openBot}
          onNew={newBlank}
          onStarter={openNew}
        />
      </>
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <BotsHeader
        list={list}
        now={now}
        onNew={newBlank}
        onDescribe={() => describe()}
      />
      <div className="flex-1 overflow-y-auto px-6 pb-6">{body}</div>
    </div>
  );
}
