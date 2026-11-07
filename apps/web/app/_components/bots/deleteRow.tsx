"use client";

import { Trash2 } from "lucide-react";
import { ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { useDeleteBot } from "@/app/utils/hooks/bots";

/** Delete bot, after a confirm; its log, alerts and price history go with it. */
export function DeleteBotRow({
  botId,
  name,
  onDeleted,
}: {
  botId: string;
  name: string;
  onDeleted: () => void;
}) {
  const remove = useDeleteBot();
  return (
    <ListGroup>
      <ListRow
        label="Delete bot"
        tone="danger"
        icon={
          <Trash2 aria-hidden className="size-4 shrink-0 text-destructive" />
        }
        onClick={() =>
          requestConfirm({
            title: `Delete ${name}?`,
            description: "Its log, alerts and price history go too.",
            confirmLabel: "Delete",
            pendingLabel: "Deleting…",
            onConfirm: async () => {
              try {
                await remove.mutateAsync(botId);
                useToastStore.getState().show(`Deleted ${name}`);
                onDeleted();
              } catch (error) {
                useToastStore.getState().show((error as Error).message);
              }
            },
          })
        }
      />
    </ListGroup>
  );
}
