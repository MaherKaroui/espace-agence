import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { inviteClient } from "@/lib/admin-clients.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

function AdminClients() {
  const [q, setQ] = useState("");

  const { data: clients = [] } = useQuery({
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

  const filtered = clients.filter((c: any) => {
    const s = `${c.prenom} ${c.nom} ${c.email} ${c.entreprise ?? ""}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Clients</h1>
          <p className="text-muted-foreground mt-1">{clients.length} inscrit(s)</p>
        </div>
        <InviteClientDialog />
      </div>
      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
        <Input placeholder="Rechercher par nom, e-mail ou entreprise…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Card className="divide-y">
        {filtered.map((c: any) => {
          const s = stats.get(c.id);
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
                <div className="font-medium truncate">{c.prenom} {c.nom}</div>
                <div className="text-xs text-muted-foreground truncate flex items-center gap-2">
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
        {filtered.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">Aucun résultat.</div>}
      </Card>
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

