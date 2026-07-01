import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Ouvre une session dès qu'un utilisateur est authentifié, envoie un heartbeat
 * toutes les 60 s tant que l'onglet est actif, et ferme proprement la session
 * à la déconnexion ou à la fermeture de l'onglet.
 */
export function SessionTracker() {
  const { user } = useAuth();
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const start = async () => {
      // Géolocalisation approximative via IP (best-effort, sans permission navigateur)
      let geo: {
        ip?: string; city?: string; region?: string; country?: string;
        country_code?: string; latitude?: number; longitude?: number;
      } = {};
      try {
        const r = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout(4000) });
        if (r.ok) {
          const j = await r.json();
          if (j?.success !== false) {
            geo = {
              ip: j.ip, city: j.city, region: j.region,
              country: j.country, country_code: j.country_code,
              latitude: j.latitude, longitude: j.longitude,
            };
          }
        }
      } catch {
        // pas grave, la session sera enregistrée sans géo
      }

      const { data, error } = await supabase.rpc("session_start", {
        _user_agent: navigator.userAgent.slice(0, 300),
        _ip: geo.ip ?? null,
        _city: geo.city ?? null,
        _region: geo.region ?? null,
        _country: geo.country ?? null,
        _country_code: geo.country_code ?? null,
        _latitude: geo.latitude ?? null,
        _longitude: geo.longitude ?? null,
      } as any);
      if (cancelled || error || !data) return;
      sessionIdRef.current = data as string;

      heartbeatRef.current = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        if (!sessionIdRef.current) return;
        supabase.rpc("session_heartbeat", { _session_id: sessionIdRef.current }).then();
      }, 60_000);
    };

    const end = () => {
      if (!sessionIdRef.current) return;
      // sendBeacon-like : appel RPC synchrone best-effort
      supabase.rpc("session_end", { _session_id: sessionIdRef.current }).then();
    };

    const onBeforeUnload = () => end();

    start();
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      end();
      sessionIdRef.current = null;
    };
  }, [user?.id]);

  return null;
}
