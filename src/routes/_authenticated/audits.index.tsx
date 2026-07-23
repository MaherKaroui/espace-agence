import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, FolderOpen, ArrowRight, MessageSquare, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { listMyAssignedDossiers } from "@/lib/dossier-assignments.functions";
import { getExternalUnreadCounts } from "@/lib/qualiopi-notifications.functions";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel } from "@/lib/labels";
import { roleLabelFr } from "@/lib/role-labels";

export const Route = createFileRoute("/_authenticated/audits/")({
  head: () => ({ meta: [{ title: "Espace Auditeur / Certificateur — IZISuivis" }] }),
  component: AuditsIndex,
});

type SortKey = "recent" | "titre" | "statut";

function AuditsIndex() {
  const listFn = useServerFn(listMyAssignedDossiers);
  const unreadFn = useServerFn(getExternalUnreadCounts);
  const { data = [], isLoading } = useQuery({
    queryKey: ["my-assigned-dossiers"],
    queryFn: () => listFn(),
  });
  const { data: unread = {} } = useQuery<Record<string, number>>({
    queryKey: ["ext-unread-counts"],
    queryFn: () => unreadFn() as any,
    refetchInterval: 30000,
  });

  const [q, setQ] = useState("");
  const [statut, setStatut] = useState<string>("all");
  const [role, setRole] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");

  const rows = data as any[];

  const statuts = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.dossier?.statut && s.add(r.dossier.statut));
    return Array.from(s);
  }, [rows]);
  const roles = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.role && s.add(r.role));
    return Array.from(s);
  }, [rows]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (statut !== "all" && r.dossier?.statut !== statut) return false;
      if (role !== "all" && r.role !== role) return false;
      if (qq) {
        const hay = `${r.dossier?.titre ?? ""} ${r.dossier?.organisme_nom ?? ""}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (sortKey === "titre") return (a.dossier?.titre ?? "").localeCompare(b.dossier?.titre ?? "");
      if (sortKey === "statut") return (a.dossier?.statut ?? "").localeCompare(b.dossier?.statut ?? "");
      return new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime();
    });
    return out;
  }, [rows, q, statut, role, sortKey]);

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Mes dossiers affectés
          {totalUnread > 0 && (
            <Badge className="bg-primary text-primary-foreground">{totalUnread} non-lu{totalUnread > 1 ? "s" : ""}</Badge>
          )}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dossiers Qualiopi sur lesquels vous intervenez comme auditeur ou certificateur.
        </p>
      </div>

      {rows.length > 0 && (
        <Card className="p-3 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Recherche titre / organisme…"
              className="pl-8 h-9"
            />
          </div>
          <Select value={statut} onValueChange={setStatut}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              {statuts.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Rôle" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous rôles</SelectItem>
              {roles.map((r) => <SelectItem key={r} value={r}>{roleLabelFr(r)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Trier : plus récent</SelectItem>
              <SelectItem value="titre">Trier : titre</SelectItem>
              <SelectItem value="statut">Trier : statut</SelectItem>
            </SelectContent>
          </Select>
        </Card>
      )}

      {isLoading && <Card className="p-4 text-sm text-muted-foreground">Chargement…</Card>}

      {!isLoading && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <FolderOpen className="h-8 w-8 mx-auto mb-3 opacity-60" />
          Vous n'êtes affecté à aucun dossier pour le moment.
        </Card>
      )}

      {!isLoading && rows.length > 0 && filtered.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Aucun dossier ne correspond à ces filtres.
        </Card>
      )}

      <div className="grid gap-3">
        {filtered.map((r) => {
          const unreadN = unread[r.dossier.id] ?? 0;
          return (
            <Link
              key={r.assignment_id}
              to="/audits/$id"
              params={{ id: r.dossier.id }}
              className="block"
            >
              <Card className="p-4 hover:border-primary/40 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline">{roleLabelFr(r.role)}</Badge>
                      <span className="text-[11px] uppercase tracking-wider text-gold font-medium">
                        {categorieLabel(r.dossier.categorie)}
                      </span>
                      <StatusBadge statut={r.dossier.statut} />
                      {unreadN > 0 && (
                        <Badge className="bg-primary text-primary-foreground">
                          <MessageSquare className="h-3 w-3 mr-1" />
                          {unreadN}
                        </Badge>
                      )}
                    </div>
                    <div className="font-display text-base truncate">{r.dossier.titre}</div>
                    {r.dossier.organisme_nom && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        OF : {r.dossier.organisme_nom}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Affecté {formatDistanceToNow(new Date(r.assigned_at), { addSuffix: true, locale: fr })}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
