"use client";

const flushes = new Map<string, () => Promise<boolean>>();

/** Lets the open sheet editor flush pending autosave from other surfaces. */
export function registerSheetFlush(sheetId: string, flush: () => Promise<boolean>) {
  flushes.set(sheetId, flush);
  return () => {
    if (flushes.get(sheetId) === flush) flushes.delete(sheetId);
  };
}

export async function flushOpenSheet(sheetId: string): Promise<boolean> {
  const flush = flushes.get(sheetId);
  return flush ? flush() : true;
}
