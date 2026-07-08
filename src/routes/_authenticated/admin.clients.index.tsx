import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { inviteClient } from "@/lib/admin-clients.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, User, Building2, UserPlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";


export const Route = createFileRoute("/_authenticated/admin/clients/")({
  head: () => ({ meta: [{ title: "Clients — Admin" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const staff = roles?.some((r) => ["admin", "direction", "manager", "consultant"].includes(r.role));
    if (!staff) throw redirect({ to: "/dashboard" });
  },
  component: AdminClients,
});

type StatusFilter = "all" | "actif" | "nouveau" | "inactif";

function AdminClients() {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // IDs de comptes internes à exclure de la liste clients
  const { data: staffIds = new Set<string>() } = useQuery({
    queryKey: ["staff-ids"],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "direction", "manager", "consultant"]);
      return new Set((data ?? []).map((r) => r.user_id as string));
    },
  });

  const { data: allProfiles = [], isLoading } = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const clients = useMemo(
    () => allProfiles.filter((c: any) => !staffIds.has(c.id)),
    [allProfiles, staffIds],
  );

  const { data: dossiersAll = [] } = useQuery({
    queryKey: ["admin-clients-dossiers"],
    queryFn: async () => {
      const { data } = await supabase.from("dossiers").select("id, client_id, statut, updated_at");
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; actifs: number; lastUpdate: string | null }>();
    for (const d of dossiersAll as any[]) {
      if (!d.client_id) continue;
      const s = m.get(d.client_id) ?? { total: 0, actifs: 0, lastUpdate: null };
      s.total += 1;
      if (!["termine", "annule"].includes(d.statut)) s.actifs += 1;
      if (d.updated_at && (!s.lastUpdate || d.updated_at > s.lastUpdate)) s.lastUpdate = d.updated_at;
      m.set(d.client_id, s);
    }
    return m;
  }, [dossiersAll]);

  const clientStatus = (c: any): "actif" | "nouveau" | "inactif" => {
    const s = stats.get(c.id);
    if (s && s.actifs > 0) return "actif";
    const createdAt = c.created_at ? new Date(c.created_at).getTime() : 0;
    if (createdAt && Date.now() - createdAt < 1000 * 60 * 60 * 24 * 30) return "nouveau";
    return "inactif";
  };

  const filtered = clients.filter((c: any) => {
    const s = `${c.prenom ?? ""} ${c.nom ?? ""} ${c.email ?? ""} ${c.entreprise ?? ""}`.toLowerCase();
    if (q && !s.includes(q.toLowerCase())) return false;
    if (statusFilter !== "all" && clientStatus(c) !== statusFilter) return false;
    return true;
  });

  const counts = useMemo(() => {
    const c = { actif: 0, nouveau: 0, inactif: 0 };
    for (const cl of clients) c[clientStatus(cl)]++;
    return c;
  }, [clients, stats]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Clients</h1>
          <p className="text-muted-foreground mt-1">
            {clients.length} client{clients.length > 1 ? "s" : ""} · {counts.actif} actif{counts.actif > 1 ? "s" : ""} · {counts.nouveau} nouveau{counts.nouveau > 1 ? "x" : ""} · {counts.inactif} inactif{counts.inactif > 1 ? "s" : ""}
          </p>
        </div>
        <InviteClientDialog />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input placeholder="Rechercher par nom, e-mail ou entreprise…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="actif">Actifs (dossier ouvert)</SelectItem>
            <SelectItem value="nouveau">Nouveaux (30 j)</SelectItem>
            <SelectItem value="inactif">Inactifs</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">Chargement des clients…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center space-y-2">
          <User className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="font-display text-lg">Aucun client à afficher</div>
          <p className="text-sm text-muted-foreground">
            {clients.length === 0 ? "Invitez votre premier client pour commencer." : "Aucun client ne correspond aux filtres."}
          </p>
        </Card>
      ) : (
        <Card className="divide-y">
          {filtered.map((c: any) => {
            const s = stats.get(c.id);
            const st = clientStatus(c);
            return (
              <Link
                key={c.id}
                to="/admin/clients/$id"
                params={{ id: c.id }}
                className="flex items-center gap-3 p-4 hover:bg-muted/30"
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium truncate">{c.prenom} {c.nom}</div>
                    {st === "actif" && <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">Actif</Badge>}
                    {st === "nouveau" && <Badge variant="outline" className="text-xs bg-info/10 text-info border-info/30">Nouveau</Badge>}
                    {st === "inactif" && <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">Inactif</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate flex items-center gap-2 mt-0.5">
                    <span>{c.email}</span>
                    {c.entreprise && (
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" /> {c.entreprise}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-sm font-medium">
                    {(s?.actifs ?? 0)} actif{(s?.actifs ?? 0) > 1 ? "s" : ""}
                    <span className="text-muted-foreground font-normal"> / {s?.total ?? 0}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s?.lastUpdate
                      ? `Activité ${formatDistanceToNow(new Date(s.lastUpdate), { addSuffix: true, locale: fr })}`
                      : "Aucune activité"}
                  </div>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function InviteClientDialog() {
  const qc = useQueryClient();
  const invite = useServerFn(inviteClient);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");

  const mutation = useMutation({
    mutationFn: async () => invite({ data: { email, prenom: prenom || undefined, nom: nom || undefined } }),
    onSuccess: (res: any) => {
      toast.success(res?.invited ? "Invitation envoyée par e-mail" : "Client déjà inscrit — rattaché");
      setOpen(false);
      setEmail(""); setPrenom(""); setNom("");
      qc.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur lors de l'invitation"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><UserPlus className="h-4 w-4 mr-2" /> Inviter un client</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inviter un client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="inv-prenom">Prénom</Label><Input id="inv-prenom" value={prenom} onChange={(e) => setPrenom(e.target.value)} /></div>
            <div><Label htmlFor="inv-nom">Nom</Label><Input id="inv-nom" value={nom} onChange={(e) => setNom(e.target.value)} /></div>
          </div>
          <div><Label htmlFor="inv-email">E-mail</Label><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@exemple.fr" /></div>
          <p className="text-xs text-muted-foreground">
            Un e-mail d'invitation sera envoyé. Si l'adresse est déjà inscrite, le compte existant sera réutilisé.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={() => mutation.mutate()} disabled={!email || mutation.isPending}>
            {mutation.isPending ? "Envoi…" : "Envoyer l'invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
