import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import StartupLoader from "../../components/ui/StartupLoader";
import { apiHealth, blockWrongServer, devApiUrl, setActiveApiUrl, setApiGate } from "../api/client";
import {
  orderCandidates,
  pickReachable,
  pinnedProbe,
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
  /** Known addresses that answered as a different Timely server on the last check. */
  wrongServer: string[];
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

/** Coming back to the app re-checks unless a check finished this recently. */
const FOREGROUND_RECHECK_MS = 10_000;
/** While nothing answers, try again this often (only while the app is open). */
const OFFLINE_RETRY_MS = 15_000;

const initialState: ServerState = { loaded: false, status: "checking", config: null, health: null, lastCheckedAt: null, wrongServer: [] };

export function ServerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServerState>(initialState);
  const configRef = useRef<ServerConfig | null>(null);
  // Dev builds can run against the emulator fallback without anything saved;
  // such a config is never written back to SecureStore.
  const persistedRef = useRef(false);
  const checkInFlight = useRef<Promise<boolean> | null>(null);
  const lastCheckedRef = useRef(0);

  /**
   * Probes the known addresses for the pinned server. `quiet` keeps the
   * current status on screen while it runs (background re-checks), instead
   * of showing "checking".
   */
  const runCheck = useCallback(async (config: ServerConfig, quiet = false) => {
    if (checkInFlight.current) return checkInFlight.current;
    checkInFlight.current = (async () => {
      if (!quiet) setState((prev) => ({ ...prev, status: "checking" }));
      const wrong: string[] = [];
      const found = await pickReachable(orderCandidates(config), pinnedProbe(probe, config.id, (url) => wrong.push(url)));
      lastCheckedRef.current = Date.now();
      // The person may have connected elsewhere while this probe ran.
      if (configRef.current !== config) return found !== null;
      if (!found) {
        // Nothing to send requests to: every address that answered is someone else.
        if (wrong.length > 0) blockWrongServer();
        setState((prev) => ({ ...prev, status: "offline", health: null, lastCheckedAt: Date.now(), wrongServer: wrong }));
        return false;
      }
      let next: ServerConfig = config;
      const pinId = !config.id && found.result.instanceId ? found.result.instanceId : undefined;
      if (config.active !== found.url || pinId) {
        next = { ...config, active: found.url, ...(pinId ? { id: pinId } : {}) };
        if (persistedRef.current) next = await serverStore.save(next);
        configRef.current = next;
      }
      setActiveApiUrl(found.url);
      setState({ loaded: true, status: "online", config: next, health: found.result, lastCheckedAt: Date.now(), wrongServer: wrong });
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
        setState({ ...initialState, loaded: true, status: "unconfigured" });
        return;
      }
      configRef.current = config;
      setActiveApiUrl(config.active ?? config.urls[0]);
      setState({ ...initialState, loaded: true, status: "checking", config });
      // Requests wait for this first probe: the remembered address may now
      // belong to a different server, which must not see the session token.
      const first = runCheck(config);
      setApiGate(first);
      await first.finally(() => setApiGate(null));
    })();
    return () => {
      cancelled = true;
    };
  }, [runCheck]);

  // Phones suspend apps and drop VPNs (HyperOS kills Tailscale): re-check when
  // the app comes back, when the network changes, and every so often while
  // nothing answers.
  useEffect(() => {
    const recheck = (minAgeMs: number) => {
      const config = configRef.current;
      if (!config || AppState.currentState !== "active") return;
      if (Date.now() - lastCheckedRef.current < minAgeMs) return;
      void runCheck(config, true);
    };
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") recheck(FOREGROUND_RECHECK_MS);
    });
    const network = Network.addNetworkStateListener((next) => {
      if (next.isConnected !== false) recheck(0);
    });
    return () => {
      appState.remove();
      network.remove();
    };
  }, [runCheck]);

  useEffect(() => {
    if (state.status !== "offline") return;
    const timer = setInterval(() => {
      const config = configRef.current;
      if (config && AppState.currentState === "active") void runCheck(config, true);
    }, OFFLINE_RETRY_MS);
    return () => clearInterval(timer);
  }, [state.status, runCheck]);

  const check = useCallback(async () => {
    const config = configRef.current;
    if (!config) return false;
    return runCheck(config);
  }, [runCheck]);

  const connect = useCallback<ServerContextValue["connect"]>(async (input, options = {}) => {
    const wrong: string[] = [];
    const found = await pickReachable(input.urls, pinnedProbe(probe, input.id, (url) => wrong.push(url)));
    if (!found) {
      if (wrong.length > 0) {
        throw new Error(`${wrong.join(", ")} answered as a different Timely server than the one in the QR code. Check the address and scan again.`);
      }
      throw new ServerUnreachableError(input.urls);
    }
    if (options.beforeApply) await options.beforeApply();
    const next: ServerConfig = { urls: input.urls, active: found.url };
    if (input.name) next.name = input.name;
    const id = input.id ?? found.result.instanceId;
    if (id) next.id = id;
    const saved = await serverStore.save(next);
    persistedRef.current = true;
    configRef.current = saved;
    lastCheckedRef.current = Date.now();
    setActiveApiUrl(found.url);
    setState({ loaded: true, status: "online", config: saved, health: found.result, lastCheckedAt: Date.now(), wrongServer: [] });
    return { url: found.url, health: found.result };
  }, []);

  const disconnect = useCallback(async () => {
    await serverStore.clear();
    persistedRef.current = false;
    configRef.current = null;
    setActiveApiUrl(null);
    setState({ ...initialState, loaded: true, status: "unconfigured" });
  }, []);

  const value = useMemo<ServerContextValue>(
    () => ({
      status: state.status,
      config: state.config,
      health: state.health,
      lastCheckedAt: state.lastCheckedAt,
      wrongServer: state.wrongServer,
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
