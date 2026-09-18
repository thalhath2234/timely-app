import { useEffect, useRef } from "react";
import { useAuth } from "../lib/auth/AuthProvider";
import { useConfigQuery, useUpdateAppearance } from "../lib/hooks";
import {
  applyAccountAppearance,
  getAccentPreference,
  getThemePreference,
} from "../lib/theme";

export default function AccountAppearanceSync() {
  const { token } = useAuth();
  const config = useConfigQuery();
  const update = useUpdateAppearance();
  const migrated = useRef(false);

  useEffect(() => {
    if (!token) return;
    const appearance = config.data?.appearance;
    if (!appearance) return;

    const serverIsDefault = appearance.theme === "system" && appearance.accent === "default";
    const localTheme = getThemePreference();
    const localAccent = getAccentPreference();
    const localDiffers = localTheme !== "system" || localAccent !== "default";

    if (!migrated.current && serverIsDefault && localDiffers) {
      migrated.current = true;
      void update.mutateAsync({ theme: localTheme, accent: localAccent }).catch(() => undefined);
      return;
    }

    migrated.current = true;
    void applyAccountAppearance({
      theme: appearance.theme,
      accent: appearance.accent,
    });
  }, [token, config.data?.appearance?.theme, config.data?.appearance?.accent, update]);

  return null;
}
