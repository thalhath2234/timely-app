"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ASSISTANT_PATH, legacyToAssistant } from "@timely/contract/assistant";

function Redirect() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    router.replace(legacyToAssistant(pathname, search) ?? ASSISTANT_PATH);
  }, [router, pathname, search]);
  return <div className="h-full bg-background" />;
}

/**
 * The old /chat and /bots pages: a deep link (?id=, ?chatId=, ?bot=,
 * ?new=1&starter=) lands on the matching /assistant URL.
 */
export default function LegacyRedirect() {
  return (
    <Suspense fallback={<div className="h-full bg-background" />}>
      <Redirect />
    </Suspense>
  );
}
