import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/admin/sessions")({
  head: () => ({ meta: [{ title: "Temps de connexion — Admin" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => r.role === "admin" || r.role === "direction");
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminSessions,
});

type Session = {
  id: string;
  user_id: string;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  user_agent: string | null;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
};

function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}

function locationLabel(s: Session): string {
  const parts = [s.city, s.region, s.country].filter((x): x is string => !!x && x.trim() !== "");
  return parts.join(", ");
}

type Profile = { id: string; nom: string | null; prenom: string | null; email: string };

function durationSecondsOf(s: Session): number {
  if (s.duration_seconds != null) return s.duration_seconds;
  const end = s.ended_at ? new Date(s.ended_at) : new Date(s.last_seen_at);
  return Math.max(0, Math.floor((end.getTime() - new Date(s.started_at).getTime()) / 1000));
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function AdminSessions() {
  const { data: sessions = [] } = useQuery({
    queryKey: ["admin-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_sessions")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Session[];
    },
    refetchInterval: 30_000,
  });

  const userIds = useMemo(() => Array.from(new Set(sessions.map((s) => s.user_id))), [sessions]);
  const { data: profiles = [] } = useQuery({
    queryKey: ["admin-sessions-profiles", userIds.join(",")],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,nom,prenom,email")
        .in("id", userIds);
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  const byUser = useMemo(() => {
    const map = new Map<string, { profile?: Profile; sessions: Session[]; total: number; open: boolean; last: string }>();
    for (const s of sessions) {
      const cur = map.get(s.user_id) ?? { sessions: [] as Session[], total: 0, open: false, last: s.started_at };
      cur.sessions.push(s);
      cur.total += durationSecondsOf(s);
      if (!s.ended_at) cur.open = true;
      if (new Date(s.started_at) > new Date(cur.last)) cur.last = s.started_at;
      map.set(s.user_id, cur);
    }
    for (const p of profiles) {
      const cur = map.get(p.id);
      if (cur) cur.profile = p;
    }
    return Array.from(map.entries())
      .map(([user_id, v]) => ({ user_id, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [sessions, profiles]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Temps de connexion</h1>
        <p className="text-muted-foreground mt-1">
          Durée cumulée par utilisateur · {sessions.length} sessions enregistrées
        </p>
      </div>

      <Card className="divide-y">
        {byUser.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">Aucune session enregistrée pour l'instant.</div>
        )}
        {byUser.map((u) => {
          const name = u.profile
            ? `${u.profile.prenom ?? ""} ${u.profile.nom ?? ""}`.trim() || u.profile.email
            : u.user_id.slice(0, 8);
          const lastGeo = u.sessions.find((s) => s.city || s.country);
          const lastLoc = lastGeo ? locationLabel(lastGeo) : "";
          const lastFlag = lastGeo ? flagEmoji(lastGeo.country_code) : "";
          return (
            <details key={u.user_id} className="group">
              <summary className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/30 list-none">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{name}</span>
                    {u.open && <Badge className="bg-success/15 text-success border-success/30">En ligne</Badge>}
                    {lastLoc && (
                      <Badge variant="outline" className="text-xs">
                        {lastFlag && <span className="mr-1">{lastFlag}</span>}
                        {lastLoc}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {u.profile?.email} · {u.sessions.length} session{u.sessions.length > 1 ? "s" : ""} · dernière {formatDistanceToNow(new Date(u.last), { addSuffix: true, locale: fr })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg tabular-nums">{formatDuration(u.total)}</div>
                  <div className="text-xs text-muted-foreground">temps total</div>
                </div>
              </summary>
              <div className="bg-muted/20 divide-y">
                {u.sessions.slice(0, 20).map((s) => {
                  const loc = locationLabel(s);
                  const flag = flagEmoji(s.country_code);
                  const mapUrl = s.latitude != null && s.longitude != null
                    ? `https://www.openstreetmap.org/?mlat=${s.latitude}&mlon=${s.longitude}#map=10/${s.latitude}/${s.longitude}`
                    : null;
                  return (
                    <div key={s.id} className="px-6 py-2 text-xs flex items-center gap-4 flex-wrap">
                      <span className="tabular-nums">{format(new Date(s.started_at), "dd/MM/yyyy HH:mm", { locale: fr })}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="tabular-nums">
                        {s.ended_at ? format(new Date(s.ended_at), "HH:mm", { locale: fr }) : <span className="text-success">en cours</span>}
                      </span>
                      {(loc || s.ip) && (
                        <span className="text-muted-foreground truncate">
                          {flag && <span className="mr-1">{flag}</span>}
                          {loc || "?"}
                          {s.ip && <span className="ml-1 opacity-60">· {s.ip}</span>}
                          {mapUrl && (
                            <a href={mapUrl} target="_blank" rel="noreferrer" className="ml-2 underline hover:text-foreground">
                              carte
                            </a>
                          )}
                        </span>
                      )}
                      <span className="ml-auto tabular-nums">{formatDuration(durationSecondsOf(s))}</span>
                    </div>
                  );
                })}
                {u.sessions.length > 20 && (
                  <div className="px-6 py-2 text-xs text-muted-foreground">… {u.sessions.length - 20} sessions plus anciennes</div>
                )}
              </div>
            </details>
          );

        })}
      </Card>
    </div>
  );
}
