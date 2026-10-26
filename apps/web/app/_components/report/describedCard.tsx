"use client";

// Before @openuidev/react-lang, which reads its devtools flag as it loads.
import "../genui/setup";
import { Fragment, useMemo, useState } from "react";
import { createLibrary, Renderer, type ComponentRenderProps, type ComponentRenderer } from "@openuidev/react-lang";
import type { DashboardData } from "@timely/contract/dashboard";
import { genuiNodes } from "@timely/contract/genui";
import { BOARD_ROOT, boardFunctions, withBoardRenderers, type BoardName, type BoardProps } from "@timely/contract/genuiBoard";
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
          {genuiNodes(props.blocks).map((block, index) => (
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
}: {
  program: string;
  data: DashboardData;
  timeZone?: string;
  now: Date;
}) {
  // New data gives new functions, so the program is read again with it.
  const library = useMemo(
    () => createLibrary({ components, functions: boardFunctions(data, { now, timeZone }), root: BOARD_ROOT }),
    [data, now, timeZone],
  );
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="p-1 text-sm text-muted-foreground">This card could not be drawn. Change it to build it again.</p>;
  return (
    <div className="-mx-3 -mb-3 h-[calc(100%+0.75rem)] overflow-y-auto" data-testid="described-card">
      <Renderer
        response={program}
        library={library}
        publishObservability={false}
        onParseResult={(result) => setFailed(Boolean(result) && !result?.root)}
      />
    </div>
  );
}
