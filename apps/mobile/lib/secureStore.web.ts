/** The web build's stand-in for the phone's keychain: localStorage in the
 * browser, nothing while Expo renders the page on the server. expo-secure-store
 * has no web implementation, so without this nobody can sign in to the Expo web
 * build. Expo web is a development and test target; phones keep the keychain. */
const storage = () =>
  typeof localStorage === "undefined" ? undefined : localStorage;

export async function getItemAsync(key: string): Promise<string | null> {
  return storage()?.getItem(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  storage()?.setItem(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  storage()?.removeItem(key);
}
