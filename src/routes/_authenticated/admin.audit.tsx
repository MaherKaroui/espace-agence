import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({ meta: [{ title: "Journal d'audit" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => r.role === "admin" || r.role === "direction");
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AuditPage,
});

function AuditPage() {
  const [severity, setSeverity] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const { data: logs = [] } = useQuery({
    queryKey: ["audit-logs", severity, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500);
      if (severity !== "all") q = q.eq("severity", severity);
      if (dateFrom) q = q.gte("created_at", new Date(dateFrom).toISOString());
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        q = q.lte("created_at", end.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-lite"],
    queryFn: async () => (await supabase.from("profiles").select("id, prenom, nom, email")).data ?? [],
  });
  const nameFor = (id: string | null) => {
    if (!id) return "—";
    const p = profiles.find((x: any) => x.id === id);
    return p ? `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email : id.slice(0, 8);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return logs;
    const s = search.toLowerCase();
    return logs.filter((l: any) =>
      l.action.toLowerCase().includes(s) ||
      (l.entity_type ?? "").toLowerCase().includes(s) ||
      JSON.stringify(l.metadata).toLowerCase().includes(s) ||
      nameFor(l.user_id).toLowerCase().includes(s)
    );
  }, [logs, search, profiles]);

  const exportCSV = () => {
    const rows = [
      ["date", "utilisateur", "action", "sévérité", "entité", "entity_id", "metadata"],
      ...filtered.map((l: any) => [
        l.created_at,
        nameFor(l.user_id),
        l.action,
        l.severity,
        l.entity_type ?? "",
        l.entity_id ?? "",
        JSON.stringify(l.metadata),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Journal d'audit</h1>
          <p className="text-muted-foreground mt-1">Traçabilité des messages, documents et alertes de sécurité.</p>
        </div>
        <Button onClick={exportCSV}><Download className="h-4 w-4 mr-2" /> Exporter CSV</Button>
      </div>

      <Card className="p-4 flex flex-wrap gap-3">
        <Input placeholder="Rechercher (action, utilisateur, contenu)…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes sévérités</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Avertissement</SelectItem>
            <SelectItem value="critical">Critique</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      <Card className="divide-y">
        {filtered.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">Aucune entrée.</div>}
        {filtered.map((l: any) => <Row key={l.id} log={l} who={nameFor(l.user_id)} />)}
      </Card>
    </div>
  );
}

function Row({ log, who }: { log: any; who: string }) {
  const Icon = log.severity === "critical" ? ShieldAlert : log.severity === "warning" ? AlertTriangle : Info;
  const tone = log.severity === "critical" ? "text-destructive" : log.severity === "warning" ? "text-warning-foreground" : "text-muted-foreground";
  const md = log.metadata ?? {};
  const prev = md.previous_content ?? md.deleted_content;
  const next = md.new_content;
  const isEdit = log.action === "message.edited";
  const isDel = log.action === "message.deleted";
  return (
    <div className="p-4 flex gap-3 items-start">
      <Icon className={`h-4 w-4 mt-1 ${tone}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{log.action}</span>
          {log.entity_type && <Badge variant="outline" className="text-xs">{log.entity_type}</Badge>}
          <Badge variant={log.severity === "warning" || log.severity === "critical" ? "destructive" : "secondary"} className="text-xs capitalize">{log.severity}</Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {who} · {format(new Date(log.created_at), "dd MMM yyyy HH:mm", { locale: fr })}
        </div>

        {(isEdit || isDel) && (prev || next) && (
          <div className="mt-2 space-y-2">
            {isEdit && (prev || next) && (
              <div className="text-sm bg-muted/40 border rounded p-2">
                <span className="font-medium">Modification : </span>
                <span className="line-through text-destructive">« {prev || "(vide)"} »</span>
                <span className="mx-2">→</span>
                <span className="text-success-foreground">« {next || "(vide)"} »</span>
              </div>
            )}
            {isDel && (
              <div className="text-sm bg-muted/40 border rounded p-2">
                <span className="font-medium">Message supprimé : </span>
                <span className="line-through text-destructive">« {prev || "(vide)"} »</span>
              </div>
            )}
            {prev !== undefined && prev !== null && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  {isDel ? "Contenu supprimé (détail)" : "Contenu avant modification"}
                </div>
                <div className="text-sm bg-destructive/5 border border-destructive/20 rounded p-2 whitespace-pre-wrap break-words">
                  {prev || <span className="italic text-muted-foreground">(vide)</span>}
                </div>
              </div>
            )}
            {isEdit && next !== undefined && next !== null && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Nouveau contenu</div>
                <div className="text-sm bg-success/5 border border-success/20 rounded p-2 whitespace-pre-wrap break-words">
                  {next || <span className="italic text-muted-foreground">(vide)</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {log.metadata && Object.keys(log.metadata).length > 0 && (
          <details className="mt-2">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Détails techniques</summary>
            <pre className="text-xs bg-muted/40 rounded p-2 mt-2 overflow-x-auto">{JSON.stringify(log.metadata, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
