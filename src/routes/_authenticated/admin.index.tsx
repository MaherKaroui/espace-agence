import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Users, FolderOpen, FileText, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Admin — Dashboard" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => ["admin","direction","manager","consultant"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminDashboard,
});

function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [clients, dossiers, documents, messages] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("dossiers").select("statut"),
        supabase.from("documents").select("id", { count: "exact", head: true }),
        supabase.from("messages").select("id", { count: "exact", head: true }),
      ]);
      const dList = dossiers.data ?? [];
      return {
        clients: clients.count ?? 0,
        dossiers: dList.length,
        documents: documents.count ?? 0,
        messages: messages.count ?? 0,
        enAttente: dList.filter((d) => ["en_attente", "documents_manquants", "a_completer"].includes(d.statut)).length,
        valides: dList.filter((d) => ["valide", "termine"].includes(d.statut)).length,
      };
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl">Tableau de bord agence</h1>
        <p className="text-muted-foreground mt-1">Vue d'ensemble de la plateforme.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Clients" value={stats?.clients ?? 0} icon={Users} />
        <StatCard label="Dossiers" value={stats?.dossiers ?? 0} icon={FolderOpen} />
        <StatCard label="Documents" value={stats?.documents ?? 0} icon={FileText} />
        <StatCard label="En attente" value={stats?.enAttente ?? 0} icon={Clock} tone="warning" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Link to="/admin/clients"><Card className="p-6 hover:border-primary/40 transition"><div className="font-display text-lg">Gérer les clients →</div><p className="text-sm text-muted-foreground mt-1">Rechercher, consulter, contacter.</p></Card></Link>
        <Link to="/admin/dossiers"><Card className="p-6 hover:border-primary/40 transition"><div className="font-display text-lg">Tous les dossiers →</div><p className="text-sm text-muted-foreground mt-1">Suivre, modifier les statuts, valider.</p></Card></Link>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone = "default" }: { label: string; value: number; icon: any; tone?: string }) {
  const colors: Record<string, string> = {
    default: "text-primary bg-primary/10",
    warning: "text-warning-foreground bg-warning/20",
  };
  return (
    <Card className="p-4">
      <div className={`h-9 w-9 rounded-lg ${colors[tone]} flex items-center justify-center mb-3`}><Icon className="h-4 w-4" /></div>
      <div className="text-2xl font-display font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Card>
  );
}
