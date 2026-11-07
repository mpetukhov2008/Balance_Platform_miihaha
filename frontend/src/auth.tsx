import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, useApi } from "./api";
import type { Session } from "./api/types";

type AuthState = {
  session: Session | null;
  /** true, если сессия была и истекла (401 во время работы). */
  expired: boolean;
  checking: boolean;
  bootError: unknown;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string, invite?: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [expired, setExpired] = useState(false);
  const [bootError, setBootError] = useState<unknown>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.onUnauthorized = () => {
      setSession((s) => {
        if (s) setExpired(true);
        return null;
      });
    };
  }, [api]);

  useEffect(() => {
    setChecking(true);
    setBootError(undefined);
    api.session().then(
      (s) => (setSession(s), setChecking(false)),
      (e) => {
        // 401 при старте — просто нет сессии; остальное показываем как ошибку.
        if (!(e instanceof ApiError && e.isUnauthorized)) setBootError(e);
        setChecking(false);
      },
    );
  }, [api, tick]);

  const login = useCallback(async (u: string, p: string) => {
    const s = await api.login(u, p);
    setExpired(false);
    setSession(s);
  }, [api]);

  const register = useCallback(async (u: string, p: string, invite?: string) => {
    const s = await api.register({ username: u, password: p, ...(invite ? { inviteCode: invite } : {}) });
    setExpired(false);
    setSession(s);
  }, [api]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setExpired(false);
    }
  }, [api]);

  return (
    <AuthContext.Provider value={{ session, expired, checking, bootError, login, register, logout, retry: () => setTick((t) => t + 1) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const a = useContext(AuthContext);
  if (!a) throw new Error("AuthProvider отсутствует");
  return a;
}
