"use client";

import PageHeader from "@/app/_components/_ui/pageHeader";
import { SkeletonCards } from "@/app/_components/_ui/skeleton";

/** The Bots page. The board lands here next; until then it shows the loading shape. */
export default function BotsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Bots" />
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <SkeletonCards />
      </div>
    </div>
  );
}
