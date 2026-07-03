import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";

type Alert = {
  id: string;
  clientId: string | null;
  clientName: string;
  reasons: string[];
  at: Date;
};

function playBeep() {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.22);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    // ignore
  }
}

export function AdminFlaggedAlert() {
  const { isAdmin } = useRole();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const audioReady = useRef(false);

  useEffect(() => {
    const unlock = () => { audioReady.current = true; };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase.channel(`admin-flagged-audit-${Math.random().toString(36).slice(2)}`);
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "audit_logs", filter: "action=eq.message.flagged" },
      async (payload) => {
        const row: any = payload.new;
        const md = row.metadata ?? {};
        const clientId: string | null = md.client_id ?? null;
        const reasons: string[] = Array.isArray(md.reasons) ? md.reasons : [];
        let clientName = "un client";
        if (clientId) {
          const { data: p } = await supabase
            .from("profiles")
            .select("prenom, nom, email")
            .eq("id", clientId)
            .maybeSingle();
          if (p) clientName = `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || clientName;
        }
        const alert: Alert = { id: row.id, clientId, clientName, reasons, at: new Date(row.created_at) };
        setAlerts((prev) => [alert, ...prev].slice(0, 5));
        if (audioReady.current) playBeep();
        setTimeout(() => {
          setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
        }, 30000);
      },
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  if (!isAdmin || alerts.length === 0) return null;

  const dismiss = (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-2xl space-y-2">
      {alerts.map((a) => {
        const keywords = a.reasons
          .filter((r) => r.startsWith("keyword:"))
          .map((r) => r.slice("keyword:".length));
        const otherFlags = a.reasons.filter((r) => !r.startsWith("keyword:"));
        return (
          <div
            key={a.id}
            className="rounded-lg border border-destructive/40 bg-destructive text-destructive-foreground shadow-lg p-3 flex items-start gap-3 animate-in slide-in-from-top-4"
          >
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Mot interdit détecté</div>
              <div className="text-sm mt-0.5">
                Conversation avec <span className="font-medium">{a.clientName}</span>
              </div>
              {(keywords.length > 0 || otherFlags.length > 0) && (
                <div className="text-xs mt-1 opacity-90">
                  {keywords.length > 0 && <>Mots : {keywords.map((k) => `« ${k} »`).join(", ")}</>}
                  {keywords.length > 0 && otherFlags.length > 0 && " · "}
                  {otherFlags.length > 0 && <>Autres : {otherFlags.join(", ")}</>}
                </div>
              )}
              {a.clientId && (
                <div className="mt-2">
                  <Button
                    asChild
                    size="sm"
                    variant="secondary"
                    onClick={() => dismiss(a.id)}
                  >
                    <Link to="/admin/messages/$clientId" params={{ clientId: a.clientId }}>
                      Voir la conversation
                    </Link>
                  </Button>
                </div>
              )}
            </div>
            <button
              onClick={() => dismiss(a.id)}
              className="p-1 rounded hover:bg-black/10 shrink-0"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
