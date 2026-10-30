"use client";

// Before @openuidev/react-lang, which reads its devtools flag as it loads.
import "../genui/setup";
import { Fragment, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { createLibrary, Renderer, type ComponentRenderProps, type ComponentRenderer } from "@openuidev/react-lang";
import type { DashboardData } from "@timely/contract/dashboard";
import { genuiNodes, replyBlocks } from "@timely/contract/genui";
import { BOARD_ROOT, boardFunctions, blockProblems, withBoardRenderers, type BoardName, type BoardProps } from "@timely/contract/genuiBoard";
import { kit, RowGroup, Surface } from "../genui/kit";

type Props<N extends BoardName> = ComponentRenderProps<BoardProps<N>>;

/*
 * A described card on the board: the agent's program (genuiBoard.ts) drawn
 * with the reply-card kit, flat inside the board card. Its @Data calls read
 * the dashboard's own data, so a tick or a refetch redraws it at once and the
 * model is never asked again.
 */

function Panel({ props, renderNode }: Props<"Panel">) {
  return (
    <Surface.Provider value="board">
      <div className="@container/board h-full">
        <div className="@container/card flex min-h-full flex-col divide-y divide-border">
          {replyBlocks(props.blocks).map((block, index) => (
            <Fragment key={index}>{renderNode(block)}</Fragment>
          ))}
        </div>
      </div>
    </Surface.Provider>
  );
}

function List({ props, renderNode }: Props<"List">) {
  const rows = genuiNodes(props.rows);
  return (
    <div className="@container/card">
      {rows.length ? (
        <RowGroup rows={rows} renderNode={renderNode} />
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">{props.empty || "Nothing here yet"}</p>
      )}
      {props.open ? <div className="border-t border-border px-4 py-2.5">{renderNode(props.open)}</div> : null}
    </div>
  );
}

const renderers: { [N in BoardName]: ComponentRenderer<BoardProps<N>> } = { ...kit, Panel, List };
const components = withBoardRenderers(renderers);

export default function DescribedCardView({
  program,
  data,
  timeZone,
  now,
  layout = "card",
}: {
  program: string;
  data: DashboardData;
  timeZone?: string;
  now: Date;
  /** "card" fills a board card edge to edge; "doc" is a live block, as tall as it needs. */
  layout?: "card" | "doc";
}) {
  // New data gives new functions, so the program is read again with it.
  const library = useMemo(
    () => createLibrary({ components, functions: boardFunctions(data, { now, timeZone }), root: BOARD_ROOT }),
    [data, now, timeZone],
  );
  // A sheet, tab, column or doc renamed after the program was written draws empty; this says why.
  const problem = useMemo(() => blockProblems(program, data)[0], [program, data]);
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <p className={layout === "doc" ? "px-4 py-3 text-sm text-muted-foreground" : "p-1 text-sm text-muted-foreground"}>
        This {layout === "doc" ? "block" : "card"} could not be drawn. Change it to build it again.
      </p>
    );
  return (
    <div className={layout === "doc" ? undefined : "-mx-3 -mb-3 h-[calc(100%+0.75rem)] overflow-y-auto"} data-testid="described-card">
      {problem ? (
        <p role="status" className="flex items-start gap-2 border-b border-border px-4 py-2.5 text-[13px] text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <span>{problem}</span>
        </p>
      ) : null}
      <Renderer
        response={program}
        library={library}
        publishObservability={false}
        onParseResult={(result) => setFailed(Boolean(result) && !result?.root)}
      />
    </div>
  );
}
