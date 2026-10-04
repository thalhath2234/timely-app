import * as SecureStore from "expo-secure-store";
import { createServerStore } from "./config";

export * from "./config";

/** The phone's remembered server list, kept in SecureStore next to the session. */
export const serverStore = createServerStore({
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  delete: (key) => SecureStore.deleteItemAsync(key),
});
