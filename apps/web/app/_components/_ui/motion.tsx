"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useState,
  useSyncExternalStore,
  ViewTransition,
  type ReactNode,
} from "react";
import { motion, type Transition, type Variants } from "motion/react";
import { cn } from "@/app/utils/cn";
import { runViewTransition } from "@/app/utils/viewTransition";

export { runViewTransition };

export const easeOut = [0.22, 1, 0.36, 1] as const;

export const springSoft: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
  mass: 0.85,
};

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 36,
  mass: 0.7,
};

export const overlayTransition: Transition = {
  duration: 0.18,
  ease: easeOut,
};

export const fadeTransition: Transition = {
  duration: 0.2,
  ease: easeOut,
};

export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const panelVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 8, scale: 0.98 },
};

export const popoverVariants: Variants = {
  hidden: { opacity: 0, y: -6, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.98 },
};

export const toastVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, x: 20, scale: 0.96 },
};

export const listContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
};

export const pageTransition: Transition = {
  duration: 0.28,
  ease: easeOut,
};

export const hoverLift = {
  y: -2,
  transition: { duration: 0.15, ease: easeOut },
};

export const tapPress = { scale: 0.98 };

/** False during SSR and the first client render so portals cannot hydrate-mismatch. */
const subscribeToNothing = () => () => {};

/**
 * False during server rendering and hydration, true once the client has
 * taken over. Implemented as an external store so the switch does not need a
 * state update inside an effect.
 */
export function useClientGate() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

export function useViewOpen(initial = false) {
  const [open, setOpenState] = useState(initial);
  const setOpen = useCallback((next: boolean) => {
    runViewTransition(() => setOpenState(next));
  }, []);
  return [open, setOpen] as const;
}

export function OverlayScrim({
  className,
  onPointerDown,
  onClick,
}: {
  className?: string;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <ViewTransition enter="scrim-in" exit="scrim-out" default="none">
      <div
        className={cn("absolute inset-0 bg-black/70", className)}
        onPointerDown={onPointerDown}
        onClick={onClick}
      />
    </ViewTransition>
  );
}

export function OverlayPanel({
  children,
  className,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <ViewTransition enter="panel-in" exit="panel-out" default="none">
      <div className={className} {...rest}>
        {children}
      </div>
    </ViewTransition>
  );
}

export function PopoverView({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="popover-in" exit="popover-out" default="none">
      {children}
    </ViewTransition>
  );
}

/** Enter-only page fade so route changes stay snappy. */
export function PageFade({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      className="h-full min-h-0"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageTransition}
    >
      {children}
    </motion.div>
  );
}
