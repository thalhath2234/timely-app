import { createContext, useContext, useEffect, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { BackHandler, Dimensions, Modal, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";

type SheetLayer = {
  id: string;
  onClose: () => void;
  render: () => ReactNode;
};

type SheetStore = {
  layers: SheetLayer[];
  upsert: (layer: SheetLayer) => void;
  remove: (id: string) => void;
};

export const useSheetStore = create<SheetStore>((set, get) => ({
  layers: [],
  upsert: (layer) => {
    const layers = get().layers;
    const index = layers.findIndex((item) => item.id === layer.id);
    if (index === -1) {
      set({ layers: [...layers, layer] });
      return;
    }
    const next = layers.slice();
    next[index] = layer;
    set({ layers: next });
  },
  remove: (id) => {
    const layers = get().layers;
    if (!layers.some((item) => item.id === id)) return;
    set({ layers: layers.filter((item) => item.id !== id) });
  },
}));

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

function AccessoryLayer() {
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

const SheetInsets = createContext({ bottom: 0 });
export function useSheetInsets() {
  return useContext(SheetInsets);
}

function overlayBottomPad(insetBottom: number) {
  const floor = Platform.OS === "android" ? 16 : 12;
  const cap = Platform.OS === "android" ? 20 : 16;
  return Math.min(Math.max(insetBottom, floor), cap);
}

/** Mount once at the app root. Transparent overlay that covers the tab bar without replacing the screen. */
export function SheetHost() {
  const layers = useSheetStore((state) => state.layers);
  const accessories = useAccessoryStore((state) => state.items);
  const top = layers[layers.length - 1];
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState(() => Dimensions.get("screen"));
  const bottom = overlayBottomPad(insets.bottom);
  const sheetOpen = layers.length > 0;

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ screen: next }) => setScreen(next));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!top) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      top.onClose();
      return true;
    });
    return () => sub.remove();
  }, [top]);

  const fillStyle = [
    styles.fill,
    Platform.OS === "android"
      ? { position: "absolute" as const, top: 0, left: 0, width: screen.width, height: screen.height }
      : null,
  ];

  return (
    <>
      <Modal
        visible={sheetOpen}
        transparent
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        presentationStyle="overFullScreen"
        hardwareAccelerated
        onRequestClose={() => top?.onClose()}
      >
        <SheetInsets.Provider value={{ bottom }}>
          <View collapsable={false} style={fillStyle}>
            {layers.map((layer, index) => (
              <View
                key={layer.id}
                pointerEvents={index === layers.length - 1 ? "auto" : "none"}
                style={styles.layer}
                collapsable={false}
              >
                {layer.render()}
              </View>
            ))}
            <AccessoryLayer />
          </View>
        </SheetInsets.Provider>
      </Modal>
      {!sheetOpen && accessories.length > 0 ? (
        <View pointerEvents="box-none" style={styles.accessoryHost}>
          <AccessoryLayer />
        </View>
      ) : null}
    </>
  );
}

export function useSheetLayer(open: boolean, onClose: () => void, render: () => ReactNode) {
  const id = useId();
  const upsert = useSheetStore((state) => state.upsert);
  const remove = useSheetStore((state) => state.remove);

  useLayoutEffect(() => {
    if (!open) {
      remove(id);
      return;
    }
    upsert({ id, onClose, render });
  });

  useLayoutEffect(() => () => remove(id), [id, remove]);
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },
  layer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
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
