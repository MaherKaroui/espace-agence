import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Progress } from "@/components/ui/progress";
import { categorieLabel } from "@/lib/labels";
import { NextActionCard } from "@/components/next-action-card";
import { computeNextAction } from "@/lib/next-action";
import { FolderOpen, FileText, Clock, CheckCircle2, AlertCircle, Upload, MessageSquare, CalendarDays } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const { isAdmin } = useRole();

  const { data: dossiers = [] } = useQuery({
    queryKey: ["dossiers-mine", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const q = supabase.from("dossiers").select("*").order("updated_at", { ascending: false });
      const { data, error } = isAdmin ? await q : await q.eq("client_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const dossierIds = dossiers.map((d) => d.id);

  const { data: allDocs = [] } = useQuery({
    queryKey: ["dashboard-docs", user?.id, dossierIds.join(",")],
    enabled: !isAdmin && dossierIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id,nom,detected_type,statut,commentaire,dossier_id")
        .in("dossier_id", dossierIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: allTaches = [] } = useQuery({
    queryKey: ["dashboard-taches", user?.id, dossierIds.join(",")],
    enabled: !isAdmin && dossierIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("taches")
        .select("id,titre,statut,cote_client,verrouillee,dossier_id")
        .in("dossier_id", dossierIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const stats = {
    total: dossiers.length,
    enAttente: dossiers.filter((d) => ["en_attente", "documents_manquants", "a_completer"].includes(d.statut)).length,
    valides: dossiers.filter((d) => ["valide", "termine"].includes(d.statut)).length,
    enCours: dossiers.filter((d) => ["en_cours_etude", "en_cours_traitement"].includes(d.statut)).length,
  };

  const activeDossiers = dossiers.filter((d) => !["termine", "annule"].includes(d.statut));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl">Bonjour 👋</h1>
        <p className="text-muted-foreground mt-1">Voici un aperçu de votre activité.</p>
      </div>

      {!isAdmin && (() => {
        const actionable = activeDossiers.filter((d) => {
          const na = computeNextAction(
            d.categorie,
            allDocs.filter((doc) => doc.dossier_id === d.id) as any,
            allTaches.filter((t) => t.dossier_id === d.id) as any,
            d.statut,
          );
          return na.kind !== "aucune" && na.kind !== "attente_agence";
        });
        const handled = activeDossiers.filter((d) => !actionable.includes(d));
        return (
          <>
            {actionable.length > 0 && (
              <div>
                <h2 className="font-display text-xl mb-3">À faire maintenant</h2>
                <div className="grid gap-2">
                  {actionable.slice(0, 4).map((d) => (
                    <Link key={d.id} to="/dossiers/$id" params={{ id: d.id }} className="block">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                        <NextActionCard
                          categorie={d.categorie}
                          documents={allDocs.filter((doc) => doc.dossier_id === d.id) as any}
                          taches={allTaches.filter((t) => t.dossier_id === d.id) as any}
                          dossierStatut={d.statut}
                          compact
                        />
                        <span className="text-xs text-muted-foreground truncate max-w-[180px]">{d.titre}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {handled.length > 0 && (
              <div>
                <h2 className="font-display text-xl mb-3">L'agence s'en occupe</h2>
                <Card className="p-4 bg-muted/30">
                  <ul className="text-sm space-y-1">
                    {handled.map((d) => (
                      <li key={d.id} className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        <Link to="/dossiers/$id" params={{ id: d.id }} className="hover:underline truncate">
                          {d.titre}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground mt-2">Rien à faire de votre côté, vous serez notifié.</p>
                </Card>
              </div>
            )}
          </>
        );
      })()}


      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FolderOpen} label="Dossiers" value={stats.total} />
        <StatCard icon={Clock} label="En attente" value={stats.enAttente} tone="warning" />
        <StatCard icon={FileText} label="En cours" value={stats.enCours} tone="info" />
        <StatCard icon={CheckCircle2} label="Validés" value={stats.valides} tone="success" />
      </div>


      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl">Dossiers récents</h2>
          <Link to="/dossiers" className="text-sm text-primary hover:underline">Tout voir →</Link>
        </div>
        {dossiers.length === 0 ? (
          <Card className="p-8 text-center">
            <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">Aucun dossier pour le moment.</p>
            <Link to="/dossiers" className="text-sm text-primary hover:underline mt-2 inline-block">Créer un dossier</Link>
          </Card>
        ) : (
          <div className="grid gap-3">
            {dossiers.slice(0, 5).map((d) => (
              <Link key={d.id} to="/dossiers/$id" params={{ id: d.id }}>
                <Card className="p-4 hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(d.categorie)}</span>
                        <StatusBadge statut={d.statut} />
                      </div>
                      <div className="font-medium truncate">{d.titre}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Mis à jour {formatDistanceToNow(new Date(d.updated_at), { addSuffix: true, locale: fr })}
                      </div>
                    </div>
                    <div className="w-24 shrink-0">
                      <div className="text-xs text-muted-foreground mb-1 text-right">{d.avancement}%</div>
                      <Progress value={d.avancement} className="h-1.5" />
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone = "default" }: { icon: any; label: string; value: number; tone?: string }) {
  const colors: Record<string, string> = {
    default: "text-primary bg-primary/10",
    warning: "text-warning-foreground bg-warning/20",
    info: "text-info bg-info/10",
    success: "text-success bg-success/10",
  };
  return (
    <Card className="p-4">
      <div className={`h-9 w-9 rounded-lg ${colors[tone]} flex items-center justify-center mb-3`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-2xl font-display font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </Card>
  );
}
