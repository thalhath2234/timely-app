import type { ReactNode } from "react";
import { DesignSwitcher } from "@/app/_components/variations/shell";

/** Design 1: the current landing page and help center, kept for comparison with /2 to /5. */
export default function DesignOneLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DesignSwitcher />
    </>
  );
}
