import { useCalendarStore } from "@/app/_store/calendarStore";
import * as motion from "motion/react-client";
import { AnimatePresence } from "framer-motion";
import { getGmtLabel, formatHour, HOURS } from "@/app/_types/types";

export default function DayView() {
  const { selectedDate, direction } = useCalendarStore();
  const dayKey = selectedDate.toISOString();
  return (
    <motion.div
      className="w-full h-full flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2, ease: "easeInOut" } }}
      exit={{ opacity: 0 }}
    >
      <div className="relative flex-1 w-full overflow-hidden h-full">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={dayKey}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.1, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0 h-full overflow-y-auto"
            style={{ scrollbarWidth: "none" }}
          >
            <table className="w-full border-collapse table-fixed text-sm">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr>
                  <th
                    scope="col"
                    className="w-14 text-xs font-normal text-white/50 text-right pr-2 align-bottom pb-1"
                  >
                    {getGmtLabel()}
                  </th>
                  <th
                    scope="col"
                    className="border-b border-white/10 py-2 font-medium"
                  >
                    <div className="text-xs text-white/50">
                      {selectedDate.toLocaleDateString("en-US", { weekday: "long" })}
                    </div>
                    <div className="text-2xl">{selectedDate.getDate()}</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {HOURS.map((h) => (
                  <tr key={h} className="h-12">
                    <th
                      scope="row"
                      className="w-14 text-xs font-normal text-white/50 text-right pr-2 align-top -translate-y-2"
                    >
                      {formatHour(h)}
                    </th>
                    <td className="border-t border-white/10" />
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

const slideVariants = {
  enter: (dir: 1 | -1 | 0) => ({
    x: dir === 0 ? 0 : dir * 40,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (dir: 1 | -1 | 0) => ({
    x: dir === 0 ? 0 : dir * -40,
    opacity: 0,
    position: "absolute" as const,
  }),
};
