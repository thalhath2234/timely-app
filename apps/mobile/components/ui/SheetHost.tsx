import { useId, useLayoutEffect, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { create } from "zustand";

type Accessory = {
  id: string;
  bottom: number;
  render: () => ReactNode;
};

type AccessoryStore = {
  items: Accessory[];
  upsert: (item: Accessory) => void;
  remove: (id: string) => void;
};

const useAccessoryStore = create<AccessoryStore>((set, get) => ({
  items: [],
  upsert: (item) => {
    const items = get().items;
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index === -1) {
      set({ items: [...items, item] });
      return;
    }
    const next = items.slice();
    next[index] = item;
    set({ items: next });
  },
  remove: (id) => {
    const items = get().items;
    if (!items.some((entry) => entry.id === id)) return;
    set({ items: items.filter((entry) => entry.id !== id) });
  },
}));

export function overlayBottomPad(insetBottom: number) {
  const floor = Platform.OS === "android" ? 16 : 12;
  const cap = Platform.OS === "android" ? 20 : 16;
  return Math.min(Math.max(insetBottom, floor), cap);
}

/** Pin a bar above the keyboard, including when a sheet Modal is open. */
export function useKeyboardAccessory(open: boolean, bottom: number, render: () => ReactNode) {
  const id = useId();
  const upsert = useAccessoryStore((state) => state.upsert);
  const remove = useAccessoryStore((state) => state.remove);

  useLayoutEffect(() => {
    if (!open) {
      remove(id);
      return;
    }
    upsert({ id, bottom, render });
  });

  useLayoutEffect(() => () => remove(id), [id, remove]);
}

export function AccessoryLayer() {
  const items = useAccessoryStore((state) => state.items);
  if (items.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={styles.accessoryHost}>
      {items.map((item) => (
        <View key={item.id} pointerEvents="box-none" style={[styles.accessory, { bottom: item.bottom }]}>
          {item.render()}
        </View>
      ))}
    </View>
  );
}

/** Root overlay for editor toolbars that are not inside a sheet Modal. */
export function SheetHost() {
  return <AccessoryLayer />;
}

const styles = StyleSheet.create({
  accessoryHost: {
    ...StyleSheet.absoluteFill,
    zIndex: 80,
    elevation: 80,
  },
  accessory: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 81,
    elevation: 81,
  },
});
