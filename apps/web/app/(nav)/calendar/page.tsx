"use client";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import * as motion from "motion/react-client";

const ViewOptions = [
  { label: "Month", value: "month" },
  { label: "Week", value: "week" },
  { label: "Day", value: "day" },
];

export default function Calendar() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string>(ViewOptions[0].value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="w-full h-full p-1 flex flex-col">
      <div className="flex w-full h-auto border-b border-white/10 py-3 px-5 justify-between">
        <div className="flex items-center gap-2">
          <button className="bg-slate-700 h-7 px-2 text-sm rounded-md border-none cursor-pointer">
            Today
          </button>
          <button className="h-7 px-2 text-sm rounded-md border-none cursor-pointer">
            <ChevronLeft className="color-white size-4" />
          </button>
          <button className="h-7 px-2 text-sm rounded-md border-none cursor-pointer">
            <ChevronRight className="color-white size-4" />
          </button>
          <b className="text-m">April 2026</b>
        </div>
        <div className="flex items-center gap-2">
          <div
            ref={wrapperRef}
            className="relative w-21 text-sm transition-all duration-300"
          >
            <button
              type="button"
              onClick={() => setOpen((p) => !p)}
              className={`w-full h-7 flex items-center justify-between rounded-md px-2 text-sm bg-slate-700 backdrop-blur text-white`}
            >
              <span>
                {ViewOptions.find((o) => o.value === selected)?.label ?? "Week"}
              </span>
              <ChevronDown
                className={`size-4 transition ${open ? "rotate-180" : ""}`}
              />
            </button>

            {open && (
              <ul
                className={`absolute z-50 mt-2 w-full rounded-md bg-slate-700 backdrop-blur shadow-lg max-h-60 overflow-auto`}
              >
                {ViewOptions.map((option) => (
                  <motion.li
                    key={option.value}
                    layoutId="view-option"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.1 }}
                  >
                    <button
                      type="button"
                      className="w-full text-left px-2 py-1 h-7 text-sm hover:bg-slate-600 cursor-pointer"
                      onClick={() => {
                        setSelected(option.value);
                        setOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  </motion.li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 w-full h-full"></div>
    </div>
  );
}
