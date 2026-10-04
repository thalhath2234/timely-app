import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import StartupLoader from "../../components/ui/StartupLoader";
import { apiHealth, devApiUrl, setActiveApiUrl } from "../api/client";
import {
  orderCandidates,
  pickReachable,
  serverStore,
  type PairingInput,
  type ServerConfig,
  type ServerHealth,
} from "./index";

/**
 * "checking": a server is configured and the launch probe is still running.
 * "online"/"offline": the probe answered / nothing answered (the last active
 * address is kept so the offline queue and ConnectivityBanner can do their job).
 * "unconfigured": no server yet; index/login/signup send the person to /connect.
 */
export type ServerStatus = "checking" | "online" | "offline" | "unconfigured";

export class ServerUnreachableError extends Error {
  urls: string[];

  constructor(urls: string[]) {
    super(
      `Could not reach ${urls.join(", ")} — is the desktop app open and Tailscale connected on both devices?`,
    );
    this.name = "ServerUnreachableError";
    this.urls = urls;
  }
}

type ServerState = {
  loaded: boolean;
  status: ServerStatus;
  config: ServerConfig | null;
  health: ServerHealth | null;
  lastCheckedAt: number | null;
};

export type ServerContextValue = Omit<ServerState, "loaded"> & {
  /** The address requests go to right now ("" when unconfigured). */
  activeUrl: string;
  /** Desktop hostname from the pairing payload, if any. */
  name: string;
  /** Re-probe every known address; resolves true when one answers. */
  check: () => Promise<boolean>;
  /**
   * Probe the pasted/scanned addresses, then persist them with the one that
   * answered as active. `beforeApply` runs between the successful probe and
   * the switch (used to sign out of the previous server first).
   */
  connect: (input: PairingInput, options?: { beforeApply?: () => Promise<void> }) => Promise<{ url: string; health: ServerHealth }>;
  /** Forget the server; status becomes "unconfigured". */
  disconnect: () => Promise<void>;
};

const ServerContext = createContext<ServerContextValue | null>(null);

const probe = (url: string, signal: AbortSignal) => apiHealth(url, { signal });

const initialState: ServerState = { loaded: false, status: "checking", config: null, health: null, lastCheckedAt: null };

export function ServerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState>(initialState);
  const configRef = useRef<ServerConfig | null>(null);
  // Dev builds can run against the emulator fallback without anything saved;
  // such a config is never written back to SecureStore.
  const persistedRef = useRef(false);
  const checkInFlight = useRef<Promise<boolean> | null>(null);

  const runCheck = useCallback(async (config: ServerConfig) => {
    if (checkInFlight.current) return checkInFlight.current;
    checkInFlight.current = (async () => {
      setState((prev) => ({ ...prev, status: "checking" }));
      const found = await pickReachable(orderCandidates(config), probe);
      // The person may have connected elsewhere while this probe ran.
      if (configRef.current !== config) return found !== null;
      if (!found) {
        setState((prev) => ({ ...prev, status: "offline", health: null, lastCheckedAt: Date.now() }));
        return false;
      }
      let next: ServerConfig = config;
      if (config.active !== found.url) {
        next = { ...config, active: found.url };
        if (persistedRef.current) next = await serverStore.save(next);
        configRef.current = next;
      }
      setActiveApiUrl(found.url);
      setState({ loaded: true, status: "online", config: next, health: found.result, lastCheckedAt: Date.now() });
      return true;
    })().finally(() => {
      checkInFlight.current = null;
    });
    return checkInFlight.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let config = await serverStore.load();
      persistedRef.current = config !== null;
      if (!config) {
        const dev = devApiUrl();
        if (dev) config = { urls: [dev], active: dev };
      }
      if (cancelled) return;
      if (!config) {
        configRef.current = null;
        setActiveApiUrl(null);
        setState({ loaded: true, status: "unconfigured", config: null, health: null, lastCheckedAt: null });
        return;
      }
      configRef.current = config;
      // Requests can start right away against the remembered address; the
      // probe below only switches if a different known address answers.
      setActiveApiUrl(config.active ?? config.urls[0]);
      setState({ loaded: true, status: "checking", config, health: null, lastCheckedAt: null });
      await runCheck(config);
    })();
    return () => {
      cancelled = true;
    };
  }, [runCheck]);

  const check = useCallback(async () => {
    const config = configRef.current;
    if (!config) return false;
    return runCheck(config);
  }, [runCheck]);

  const connect = useCallback<ServerContextValue["connect"]>(async (input, options = {}) => {
    const found = await pickReachable(input.urls, probe);
    if (!found) throw new ServerUnreachableError(input.urls);
    if (options.beforeApply) await options.beforeApply();
    const next: ServerConfig = { urls: input.urls, active: found.url };
    if (input.name) next.name = input.name;
    const saved = await serverStore.save(next);
    persistedRef.current = true;
    configRef.current = saved;
    setActiveApiUrl(found.url);
    setState({ loaded: true, status: "online", config: saved, health: found.result, lastCheckedAt: Date.now() });
    return { url: found.url, health: found.result };
  }, []);

  const disconnect = useCallback(async () => {
    await serverStore.clear();
    persistedRef.current = false;
    configRef.current = null;
    setActiveApiUrl(null);
    setState({ loaded: true, status: "unconfigured", config: null, health: null, lastCheckedAt: null });
  }, []);

  const value = useMemo<ServerContextValue>(
    () => ({
      status: state.status,
      config: state.config,
      health: state.health,
      lastCheckedAt: state.lastCheckedAt,
      activeUrl: state.config?.active ?? state.config?.urls[0] ?? "",
      name: state.config?.name ?? "",
      check,
      connect,
      disconnect,
    }),
    [state, check, connect, disconnect],
  );

  if (!state.loaded) return <StartupLoader />;
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer() {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error("useServer must be used inside ServerProvider");
  return ctx;
}
