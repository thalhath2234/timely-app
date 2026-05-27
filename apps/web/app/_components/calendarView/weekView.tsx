import { useCalendarStore } from "@/app/_store/calendarStore";
import * as motion from "motion/react-client";
import { AnimatePresence } from "framer-motion";
import { formatHour, getGmtLabel, HOURS } from "@/app/_types/types";

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthView() {
  const { selectedDate, direction } = useCalendarStore();
  const days = getWeekGrid(selectedDate);
  const weekKey = days[0].toISOString();
  return (
    <motion.div
      className="w-full h-full flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2, ease: "easeInOut" } }}
      exit={{ opacity: 0 }}
    >
      <div className="relative flex-1 w-full overflow-auto h-full" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={weekKey}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.1, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0 h-full"
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
                  {days.map((day) => {
                    const isToday = isSameDay(day, new Date());
                    return (
                      <th
                        key={day.toISOString()}
                        scope="col"
                        className={[
                          "border-b border-white/10 py-2 font-medium",
                          isToday ? "text-blue-400" : "",
                        ].join(" ")}
                      >
                        <div className="text-xs text-white/50">
                          {weekdayNames[day.getDay()]}
                        </div>
                        <div className="text-2xl">{day.getDate()}</div>
                      </th>
                    );
                  })}
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
                    {days.map((day) => (
                      <td
                        key={day.toISOString()}
                        className={`border-t border-l border-white/10 ${isSameDay(day, new Date()) ? "bg-slate-700/40" : ""}`}
                      />
                    ))}
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

function getWeekGrid(date: Date) {
  const firstOfWeek = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - date.getDay(),
  );
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(firstOfWeek);
    d.setDate(firstOfWeek.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
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
