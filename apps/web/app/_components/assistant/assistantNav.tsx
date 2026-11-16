"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { motion } from "motion/react";
import { ASSISTANT_PATH } from "@timely/contract/assistant";
import { hoverLift, tapPress } from "@/app/_components/_ui/motion";
import { useNowMinute } from "@/app/_components/auth/clock";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { SIDEBAR_ITEMS, type SidebarProps } from "@/app/_types/types";
import { useBots } from "@/app/utils/hooks/bots";
import { useChats } from "@/app/utils/hooks/chat";
import { plural } from "@/app/utils/plural";
import { buildInbox, type InboxChat } from "./inbox";

/** The sidebar's one Assistant entry, where Chat and Bots were. */
export const ASSISTANT_NAV_ITEM: SidebarProps = {
  name: "Assistant",
  icon: "MessageCircle",
  href: ASSISTANT_PATH,
};

/** The sidebar entries: Assistant in Chat's place, Bots folded into it. */
export function navItems(): SidebarProps[] {
  return SIDEBAR_ITEMS.flatMap((item) =>
    item.name === "Chat" ? [ASSISTANT_NAV_ITEM] : item.name === "Bots" ? [] : [item],
  );
}

/** Rows that wait on the person, plus chats with an unread reply. */
function useAssistantBadge(): number {
  const chats = useChats().data;
  const bots = useBots().data?.bots;
  const minute = useNowMinute();
  const now = new Date((minute ?? 0) * 60_000);
  if (minute === null) return 0;
  const inbox = buildInbox((chats ?? []) as InboxChat[], bots ?? [], now);
  return inbox.needs.length + inbox.recent.filter((i) => i.unread).length;
}

function AssistantBadge() {
  const count = useAssistantBadge();
  if (!count) return null;
  return (
    <motion.span
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      aria-label={plural(count, "item") + " for you"}
      className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-semibold leading-4 text-primary-foreground"
    >
      {count > 9 ? "9+" : count}
    </motion.span>
  );
}

/** The sidebar button for the Assistant, with one badge for chats and Bots. */
export function AssistantNavButton() {
  const { setActiveItem } = useSidebarStore();
  const pathname = usePathname();
  const isActive = pathname.startsWith(ASSISTANT_PATH);
  return (
    <motion.div
      className={`m-0 cursor-pointer rounded-lg border-none transition-colors ${isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-fill"} hover:text-primary`}
      whileHover={hoverLift}
      whileTap={tapPress}
      onClick={() => setActiveItem(ASSISTANT_NAV_ITEM.name)}
    >
      <Link
        href={ASSISTANT_PATH}
        aria-label={ASSISTANT_NAV_ITEM.name}
        aria-current={isActive ? "page" : undefined}
        className={`relative flex size-9 items-center justify-center rounded-lg transition-colors ${isActive ? "text-primary" : "text-muted-foreground"} hover:text-primary`}
      >
        <MessageCircle className="size-5" />
        <AssistantBadge />
      </Link>
    </motion.div>
  );
}
