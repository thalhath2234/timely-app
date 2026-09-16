"use client";

import ConfirmDialog from "@/app/_components/_ui/confirmDialog";
import { useConfirmStore } from "@/app/_store/confirmStore";

/** Renders confirmations raised by code with nowhere to mount a dialog of its
 * own, such as context menu actions. */
export default function ConfirmHost() {
  const request = useConfirmStore((state) => state.request);
  const pending = useConfirmStore((state) => state.pending);
  const cancel = useConfirmStore((state) => state.cancel);
  const setPending = useConfirmStore((state) => state.setPending);

  if (!request) return null;

  return (
    <ConfirmDialog
      key={request.id}
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel}
      pendingLabel={request.pendingLabel}
      pending={pending}
      onCancel={cancel}
      onConfirm={() => {
        setPending(true);
        void Promise.resolve(request.onConfirm())
          .catch(() => undefined)
          .finally(() => useConfirmStore.getState().cancel());
      }}
    />
  );
}
