import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "../types";
import { completeOnboarding, getMe, login as loginApi, register as registerApi, logout as logoutApi, refreshSession } from "../api/auth";
import { createWorkspace } from "../api/workspaces";
import { unregisterServerPush } from "../notifications";
import { ApiError, flushOfflineQueue } from "../api/client";
import { clearToken, getRefreshToken, getToken, onSessionExpired, setSession } from "./session";
import { setOfflineQueueUser } from "../offlineQueue";

type AuthState = {
  ready: boolean;
  token: string | null;
  user: User | null;
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<User>;
  signup: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<User | null>;
  finishOnboarding: (workspaceName: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function onboarded(user: User | null) {
  return Boolean(user?.is_on_boarding_completed);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ ready: false, token: null, user: null });

  async function hydrate(token: string) {
    const user = await getMe();
    setOfflineQueueUser(user.id);
    void flushOfflineQueue().then(() => queryClient.invalidateQueries());
    queryClient.setQueryData(["me"], user);
    setState({ ready: true, token, user });
    return user;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) {
        setOfflineQueueUser(null);
        if (!cancelled) setState({ ready: true, token: null, user: null });
        return;
      }
      try {
        if (!cancelled) await hydrate(token);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await clearToken();
          setOfflineQueueUser(null);
          if (!cancelled) setState({ ready: true, token: null, user: null });
          return;
        }
        try {
          const refreshToken = await getRefreshToken();
          if (refreshToken) {
            const session = await refreshSession(refreshToken);
            await setSession(session.token, session.refreshToken);
            if (!cancelled) await hydrate(session.token);
            return;
          }
        } catch {
          // fall through to keep the stored token and retry on next launch
        }
        if (!cancelled) setState({ ready: true, token, user: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return onSessionExpired(() => {
      queryClient.clear();
      setOfflineQueueUser(null);
      setState({ ready: true, token: null, user: null });
    });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login: async (email, password) => {
        const session = await loginApi(email, password);
        await setSession(session.token, session.refreshToken);
        return hydrate(session.token);
      },
      signup: async (name, email, password) => {
        const session = await registerApi(name, email, password);
        await setSession(session.token, session.refreshToken);
        return hydrate(session.token);
      },
      logout: async () => {
        await unregisterServerPush();
        await logoutApi();
        await clearToken();
        setOfflineQueueUser(null);
        queryClient.clear();
        setState({ ready: true, token: null, user: null });
      },
      refresh: async () => {
        try {
          const token = await getToken();
          if (!token) {
            setOfflineQueueUser(null);
            setState({ ready: true, token: null, user: null });
            return null;
          }
          return await hydrate(token);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            await clearToken();
            setOfflineQueueUser(null);
            setState({ ready: true, token: null, user: null });
          }
          return null;
        }
      },
      finishOnboarding: async (workspaceName: string) => {
        await createWorkspace({ name: workspaceName });
        if (!onboarded(state.user)) await completeOnboarding();
        const refreshToken = await getRefreshToken();
        if (refreshToken) {
          try {
            const session = await refreshSession(refreshToken);
            await setSession(session.token, session.refreshToken);
          } catch {
            // keep the existing access token if refresh is unavailable
          }
        }
        const user = await getMe();
        queryClient.setQueryData(["me"], user);
        setState((prev) => ({ ...prev, user }));
      },
    }),
    [state, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function isOnboarded(user: User | null) {
  return onboarded(user);
}
