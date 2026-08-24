import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  /** Vrai tant que l'authentification n'est pas résolue (aucune valeur fiable connue). */
  loading: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * Lecture SYNCHRONE de la session persistée (copie locale écrite par supabase-js).
 * Permet d'avoir `user` dès le tout premier rendu client, au lieu d'un passage
 * transitoire par `null` qui fait clignoter toutes les vues authentifiées.
 */
function readPersistedSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.*-auth-token$/.test(key)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const session: Session | null = parsed?.access_token ? parsed : (parsed?.currentSession ?? null);
      if (!session?.access_token || !session?.user) continue;
      if (session.expires_at && session.expires_at * 1000 < Date.now()) continue;
      return session as Session;
    }
  } catch {
    /* storage inaccessible ou contenu illisible : on retombe sur getSession() */
  }
  return null;
}

export function AuthProvider({
  children,
  onAuthEvent,
}: {
  children: ReactNode;
  onAuthEvent?: (event: AuthChangeEvent, session: Session | null) => void;
}) {
  const [session, setSession] = useState<Session | null>(() => readPersistedSession());
  const [resolved, setResolved] = useState(false);

  const eventHandler = useRef(onAuthEvent);
  eventHandler.current = onAuthEvent;

  useEffect(() => {
    // UN SEUL abonnement pour toute l'application.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setResolved(true);
      eventHandler.current?.(event, s);
    });
    // UN SEUL getSession() : il confirme/rafraîchit la valeur initiale.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setResolved(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      // Si une session persistée est déjà connue, l'authentification n'est pas « en cours ».
      loading: !resolved && session === null,
    }),
    [session, resolved],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  // Hors provider (ne devrait pas arriver) : état neutre « en cours de résolution ».
  return { session: null, user: null, loading: true };
}
