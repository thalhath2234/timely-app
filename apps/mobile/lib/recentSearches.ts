import { create } from "zustand";
import * as SecureStore from "./secureStore";
import type { SearchHit } from "./api/search";

/**
 * The last few things opened from Search, so the empty search screen offers
 * them back before the quick actions. Kept on the device only.
 */
export interface RecentHit {
  kind: SearchHit["kind"];
  id: string;
  title: string;
}

const KEY = "timely.recentSearches";
export const RECENT_LIMIT = 6;

interface RecentState {
  items: RecentHit[];
  loaded: boolean;
  load: () => Promise<void>;
  remember: (hit: RecentHit) => void;
  forget: (hit: RecentHit) => void;
  clear: () => void;
}

function persist(items: RecentHit[]) {
  void SecureStore.setItemAsync(KEY, JSON.stringify(items)).catch(() => undefined);
}

export const useRecentSearches = create<RecentState>((set, get) => ({
  items: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      const parsed = raw ? (JSON.parse(raw) as RecentHit[]) : [];
      set({ items: Array.isArray(parsed) ? parsed.slice(0, RECENT_LIMIT) : [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  remember: (hit) => {
    const items = [hit, ...get().items.filter((item) => !(item.kind === hit.kind && item.id === hit.id))].slice(0, RECENT_LIMIT);
    set({ items });
    persist(items);
  },
  forget: (hit) => {
    const items = get().items.filter((item) => !(item.kind === hit.kind && item.id === hit.id));
    set({ items });
    persist(items);
  },
  clear: () => {
    set({ items: [] });
    persist([]);
  },
}));
