import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel } from "@/lib/labels";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelanceButton } from "@/components/relance-button";

export const Route = createFileRoute("/_authenticated/admin/clients/$id")({
  head: () => ({ meta: [{ title: "Client — Admin" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    if (!roles?.some((r) => r.role === "admin")) throw redirect({ to: "/dashboard" });
  },
  component: ClientDetail,
});

function ClientDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();

  const { data: profile } = useQuery({
    queryKey: ["profile", id],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", id).maybeSingle()).data,
  });
  const { data: dossiers = [] } = useQuery({
    queryKey: ["dossiers-client", id],
    queryFn: async () => (await supabase.from("dossiers").select("*").eq("client_id", id).order("updated_at", { ascending: false })).data ?? [],
  });

  return (
    <div className="space-y-6">
      <button onClick={() => nav({ to: "/admin/clients" })} className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Retour
      </button>

      <Card className="p-6">
        <h1 className="font-display text-2xl">{profile?.prenom} {profile?.nom}</h1>
        <p className="text-muted-foreground">{profile?.email}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/admin/messages/$clientId" params={{ clientId: id }}>
            <Button variant="outline"><MessageSquare className="h-4 w-4 mr-2" /> Ouvrir la conversation</Button>
          </Link>
          <RelanceButton clientId={id} clientEmail={profile?.email} />
        </div>
      </Card>

      <div>
        <h2 className="font-display text-xl mb-3">Dossiers ({dossiers.length})</h2>
        {dossiers.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">Aucun dossier.</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {dossiers.map((d) => (
              <Link key={d.id} to="/dossiers/$id" params={{ id: d.id }}>
                <Card className="p-4 hover:border-primary/40 transition">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(d.categorie)}</span>
                    <StatusBadge statut={d.statut} />
                  </div>
                  <div className="font-medium">{d.titre}</div>
                  <div className="text-xs text-muted-foreground mt-1">Avancement : {d.avancement}%</div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
