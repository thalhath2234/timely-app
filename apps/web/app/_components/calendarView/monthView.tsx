import { useCalendarStore } from "@/app/_store/calendarStore";
import * as motion from "motion/react-client";
import { AnimatePresence } from "framer-motion";

const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthView() {
  const { selectedDate, direction } = useCalendarStore();
  const days = getMonthGrid(selectedDate);
  const monthKey = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}`;
  return (
    <motion.div
      className="w-full h-full flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.2, ease: "easeInOut" } }}
      exit={{ opacity: 0 }}
    >
      <div className="w-full h-8 grid grid-cols-7 gap-1 text-bold text-center items-center justify-center bg-slate-900 text-xs text-white/50">
        {daysOfWeek.map((day) => (
          <div key={day} id={day}>
            {day}
          </div>
        ))}
      </div>
      <div
        className="relative flex-1 w-full overflow-auto"
        style={{ scrollbarWidth: "none" }}
      >
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={monthKey}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.1, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0 grid grid-cols-7 grid-rows-6 gap-1"
          >
            {days.map((day) => {
              const inMonth = day.getMonth() === selectedDate.getMonth();
              const isToday = isSameDay(day, new Date());
              return (
                <div
                  key={day.toISOString()}
                  className={[
                    "border border-white/10 p-1 text-sm",
                    inMonth ? "text-white" : "text-white/30",
                    isToday ? "bg-slate-700/40" : "",
                  ].join(" ")}
                >
                  {day.getDate()}
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function getMonthGrid(date: Date) {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);

  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
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
