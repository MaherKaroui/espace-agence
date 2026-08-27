import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Hash, Loader2, Lock, MessageSquare, RefreshCw, Paperclip } from "lucide-react";

const PAGE = 100;

/** Explorateur des canaux Slack rapatriés et de leurs messages. Réservé à l'équipe. */
export function SlackCanauxExplorer() {
  const [q, setQ] = useState("");
  const [canalId, setCanalId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const canaux = useQuery({
    queryKey: ["slack-explorer-canaux"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slack_canaux")
        .select("id, nom, type, is_archived, membres_count, collecte_messages, collecte_terminee, collecte_erreur")
        .order("collecte_messages", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const membres = useQuery({
    queryKey: ["slack-explorer-membres"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slack_membres")
        .select("slack_user_id, nom, display_name")
        .limit(2000);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const m of data ?? []) map[m.slack_user_id] = m.display_name || m.nom || m.slack_user_id;
      return map;
    },
  });

  const messages = useQuery({
    queryKey: ["slack-explorer-messages", canalId, page],
    enabled: !!canalId,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("slack_messages")
        .select("id, auteur, slack_user_id, texte, posted_at, files, thread_ts, ts", { count: "exact" })
        .eq("canal_id", canalId!)
        .order("posted_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
  });

  const liste = useMemo(() => {
    const terme = q.trim().toLowerCase();
    const rows = canaux.data ?? [];
    return terme ? rows.filter((c: any) => (c.nom ?? "").toLowerCase().includes(terme)) : rows;
  }, [canaux.data, q]);

  const canal = (canaux.data ?? []).find((c: any) => c.id === canalId);
  const nomDe = (id?: string | null, fallback?: string | null) =>
    (id && membres.data?.[id]) || fallback || id || "—";

  const rendre = (texte: string | null) =>
    (texte ?? "").replace(/<@([A-Z0-9]+)>/g, (_, id) => `@${membres.data?.[id] ?? id}`);

  const totalMessages = (canaux.data ?? []).reduce(
    (n: number, c: any) => n + (c.collecte_messages ?? 0),
    0,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">
            {liste.length} canal(aux) · {totalMessages.toLocaleString("fr-FR")} messages
          </div>
          <Button size="icon" variant="ghost" onClick={() => canaux.refetch()}>
            {canaux.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
        <Input placeholder="Filtrer les canaux…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[560px] overflow-auto divide-y rounded border">
          {liste.map((c: any) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { setCanalId(c.id); setPage(0); }}
              className={`flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-muted ${
                canalId === c.id ? "bg-muted" : ""
              }`}
            >
              {c.type === "prive" ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <Hash className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate font-medium">{c.nom}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {(c.collecte_messages ?? 0).toLocaleString("fr-FR")}
              </span>
            </button>
          ))}
          {!liste.length ? (
            <p className="p-3 text-sm text-muted-foreground">
              {canaux.isLoading ? "Chargement…" : "Aucun canal."}
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        {!canal ? (
          <p className="text-sm text-muted-foreground">
            Sélectionnez un canal à gauche pour lire les messages rapatriés.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium flex items-center gap-1">
                {canal.type === "prive" ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                {canal.nom}
              </h3>
              <Badge variant="outline">{canal.type === "prive" ? "privé" : "public"}</Badge>
              {canal.is_archived ? <Badge variant="secondary">archivé</Badge> : null}
              {canal.collecte_terminee ? <Badge variant="outline">collecte terminée</Badge> : null}
              <span className="ml-auto text-sm text-muted-foreground flex items-center gap-1">
                <MessageSquare className="h-4 w-4" />
                {(messages.data?.total ?? 0).toLocaleString("fr-FR")} messages
              </span>
            </div>

            {canal.collecte_erreur ? (
              <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                {canal.collecte_erreur}
              </p>
            ) : null}

            <div className="max-h-[520px] space-y-3 overflow-auto rounded border p-3">
              {messages.isFetching ? (
                <p className="text-sm text-muted-foreground">Chargement des messages…</p>
              ) : null}
              {(messages.data?.rows ?? []).map((m: any) => (
                <div key={m.id} className="border-b pb-2 last:border-0">
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground">{nomDe(m.slack_user_id, m.auteur)}</strong>
                    {" · "}
                    {m.posted_at ? new Date(m.posted_at).toLocaleString("fr-FR") : ""}
                    {m.thread_ts && m.thread_ts !== m.ts ? " · réponse dans un fil" : ""}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{rendre(m.texte) || <em>(sans texte)</em>}</p>
                  {Array.isArray(m.files) && m.files.length ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Paperclip className="h-3 w-3" /> {m.files.length} fichier(s) joint(s)
                    </p>
                  ) : null}
                </div>
              ))}
              {!messages.isFetching && !(messages.data?.rows ?? []).length ? (
                <p className="text-sm text-muted-foreground">
                  Aucun message rapatrié pour ce canal pour l'instant.
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Précédent
              </Button>
              <span className="text-muted-foreground">
                Page {page + 1} / {Math.max(1, Math.ceil((messages.data?.total ?? 0) / PAGE))}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * PAGE >= (messages.data?.total ?? 0)}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
