"use client";
import { useEffect } from "react";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import * as motion from "motion/react-client";
import { AnimatePresence } from "framer-motion";

export default function AddItemModal() {
  const { addItemMode, setAddItemMode } = useSidebarStore();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAddItemMode(false);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAddItemMode(!useSidebarStore.getState().addItemMode);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setAddItemMode]);

  return (
    <AnimatePresence>
      {addItemMode && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        //   exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.01, ease: "easeOut" }}
          onClick={() => setAddItemMode(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className="w-[600px] max-w-[90vw] max-h-[60vh] rounded-lg border border-white/40 shadow-2xl overflow-hidden flex flex-col backdrop-blur-md"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              type="text"
              placeholder="Search..."
              className="w-full px-4 py-3 bg-transparent text-white placeholder-white/40 outline-none border-b border-white/10"
            />
            <div className="flex-1 overflow-y-auto p-2 text-sm text-white/80">
              <div className="px-3 py-2 text-xs text-white/40">Pages</div>
              {/* result rows go here */}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
