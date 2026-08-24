import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slack, Search } from "lucide-react";

/** Historique Slack repris, rattaché à ce client. Réservé à l'équipe de l'agence. */
export function SlackClientHistory({ clientId }: { clientId: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const canaux = useQuery({
    queryKey: ["slack-canaux-client", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("slack_canaux")
        .select("id, nom, type")
        .eq("client_id", clientId);
      return data ?? [];
    },
  });

  const ids = (canaux.data ?? []).map((c: any) => c.id);

  const messages = useQuery({
    queryKey: ["slack-messages-client", clientId, ids.join(","), q],
    enabled: open && ids.length > 0,
    queryFn: async () => {
      let req = supabase
        .from("slack_messages")
        .select("id, auteur, texte, posted_at, slack_canaux(nom)")
        .in("canal_id", ids)
        .order("posted_at", { ascending: false })
        .limit(100);
      if (q.trim().length > 1) {
        req = req.textSearch("recherche", q.trim(), { type: "websearch", config: "french" });
      }
      const { data, error } = await req;
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!canaux.data?.length) return null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Slack className="h-4 w-4" />
        <span className="font-medium">Historique Slack repris</span>
        {(canaux.data ?? []).map((c: any) => (
          <Badge key={c.id} variant="outline">#{c.nom}</Badge>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen((o) => !o)}>
          {open ? "Masquer" : "Consulter"}
        </Button>
      </div>

      {open && (
        <>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher dans cet historique…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="space-y-2 max-h-[420px] overflow-auto">
            {messages.isFetching && <p className="text-sm text-muted-foreground">Chargement…</p>}
            {(messages.data ?? []).map((m: any) => (
              <div key={m.id} className="border-b pb-2 last:border-0">
                <p className="text-xs text-muted-foreground">
                  #{m.slack_canaux?.nom} · {m.auteur} ·{" "}
                  {m.posted_at ? new Date(m.posted_at).toLocaleString("fr-FR") : ""}
                </p>
                <p className="text-sm whitespace-pre-wrap">{m.texte}</p>
              </div>
            ))}
            {!messages.isFetching && (messages.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun message.</p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
