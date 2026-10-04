import { ConfirmHost, requestConfirm } from "@timely/ui";
import { useEffect } from "react";

export const DeleteFromMenu = () => {
  useEffect(() => {
    requestConfirm({
      title: "Delete “Review Q4 roadmap with Sam”?",
      description: "The task and its calendar block will be removed. This can’t be undone.",
      confirmLabel: "Delete",
      pendingLabel: "Deleting…",
      onConfirm: () => undefined,
    });
  }, []);
  return <ConfirmHost />;
};

export const SignOut = () => {
  useEffect(() => {
    requestConfirm({
      title: "Sign out of Timely?",
      description: "Unsynced changes on this device will be kept and uploaded next time you sign in.",
      confirmLabel: "Sign out",
      onConfirm: () => undefined,
    });
  }, []);
  return <ConfirmHost />;
};
