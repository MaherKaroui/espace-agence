import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { PushActivationBanner } from "@/components/push-activation-banner";
import { StatusBadge } from "@/components/status-badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { categorieLabel } from "@/lib/labels";
import { NextActionCard } from "@/components/next-action-card";
import { computeNextAction } from "@/lib/next-action";
import { computeAvancement, etapesLabel, toTaches } from "@/lib/dossier-progress";
import { FolderOpen, FileText, Clock, CheckCircle2, AlertCircle, Upload, MessageSquare, CalendarDays } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { sendTransactionalEmail } from "@/lib/email/send";
import { APP_URL } from "@/lib/app-url";




export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isStaff } = useRole();
  const navigate = useNavigate();

  // Séparation nette admin / client : les membres de l'agence sont
  // redirigés vers leur vue agence dès l'arrivée sur le dashboard.
  useEffect(() => {
    if (isStaff) navigate({ to: "/admin", replace: true });
  }, [isStaff, navigate]);

  // Envoi des e-mails de bienvenue au 1er accès (fallback si l'inscription
  // s'est faite sans session — cas confirmation e-mail).
  useEffect(() => {
    if (!user || isStaff) return;
    const flagKey = `welcome-sent-${user.id}`;
    if (localStorage.getItem(flagKey)) return;
    const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
    if (!createdAt || Date.now() - createdAt > 1000 * 60 * 60 * 24 * 7) {
      // Utilisateur existant : ne pas renvoyer
      localStorage.setItem(flagKey, "1");
      return;
    }
    const prenom = (user.user_metadata as any)?.prenom ?? "";
    const nom = (user.user_metadata as any)?.nom ?? "";
    const clientName = `${prenom} ${nom}`.trim() || user.email || "Client";
    const appUrl = APP_URL;
    Promise.all([
      sendTransactionalEmail({
        templateName: "admin-new-client",
        idempotencyKey: `admin-new-client-${user.id}`,
        templateData: { clientName, clientEmail: user.email, appUrl },
      }),
      sendTransactionalEmail({
        templateName: "welcome-client",
        recipientEmail: user.email,
        idempotencyKey: `welcome-client-${user.id}`,
        templateData: { prenom, appUrl },
      }),
    ]).finally(() => localStorage.setItem(flagKey, "1"));
  }, [user, isStaff]);



  const { data: dossiers = [], isLoading: dossiersLoading, isFetched: dossiersFetched } = useQuery({
    queryKey: ["dossiers-mine", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
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
    enabled: dossierIds.length > 0,
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,

    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id,nom,detected_type,dossier_id")
        .in("dossier_id", dossierIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: allTaches = [] } = useQuery({
    queryKey: ["dashboard-taches", user?.id, dossierIds.join(",")],
    enabled: dossierIds.length > 0,
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
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
  const isLoadingDossiers = authLoading || dossiersLoading || !dossiersFetched;
  const isEmpty = !isLoadingDossiers && dossiers.length === 0;

  const actionable = isAdmin
    ? []
    : activeDossiers.filter((d) => {
        const na = computeNextAction(
          d.categorie,
          allDocs.filter((doc) => doc.dossier_id === d.id) as any,
          allTaches.filter((t) => t.dossier_id === d.id) as any,
          d.statut,
        );
        return na.kind !== "aucune" && na.kind !== "attente_agence";
      });
  const handled = isAdmin ? [] : activeDossiers.filter((d) => !actionable.includes(d));

  return (
    <div className="space-y-8">
      <PushActivationBanner />
      <div>
        <h1 className="font-display text-2xl sm:text-3xl">Bonjour 👋</h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">Voici un aperçu de votre activité.</p>
      </div>

      {!isAdmin && isEmpty && (
        <Card className="p-6 border-primary/20 bg-primary/5">
          <h2 className="font-display text-xl mb-1">Bienvenue dans votre espace</h2>
          <p className="text-sm text-muted-foreground mb-5">Voici comment ça marche, en 4 étapes simples :</p>
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
            <GuideStep n={1} icon={FolderOpen} title="Créez un dossier" text="Choisissez votre demande (Qualiopi, NDA, EDOF…)." />
            <GuideStep n={2} icon={Upload} title="Déposez vos documents" text="On vous guide fichier par fichier." />
            <GuideStep n={3} icon={MessageSquare} title="Échangez avec l'agence" text="Messagerie sécurisée intégrée." />
            <GuideStep n={4} icon={CheckCircle2} title="Suivez l'avancement" text="Statuts et notifications en temps réel." />
          </ol>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/dossiers" className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90">
              <FolderOpen className="h-4 w-4" /> Créer mon premier dossier
            </Link>
            <Link to="/rendez-vous" className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-accent">
              <CalendarDays className="h-4 w-4" /> Prendre rendez-vous
            </Link>
          </div>
        </Card>
      )}


      {!(isEmpty && !isAdmin) && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="min-w-0 space-y-8">
            {actionable.length > 0 && (
              <section>
                <h2 className="font-display text-lg sm:text-xl mb-3">À faire maintenant</h2>
                <ul className="space-y-4">
                  {actionable.slice(0, 4).map((d) => (
                    <li key={d.id} className="min-w-0">
                      <Link
                        to="/dossiers/$id"
                        params={{ id: d.id }}
                        className="group block space-y-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <span className="block truncate text-sm font-medium group-hover:underline underline-offset-4">
                          {d.titre}
                        </span>
                        <NextActionCard
                          categorie={d.categorie}
                          documents={allDocs.filter((doc) => doc.dossier_id === d.id) as any}
                          taches={allTaches.filter((t) => t.dossier_id === d.id) as any}
                          dossierStatut={d.statut}
                          compact
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <div className="flex items-baseline justify-between mb-3 gap-2">
                <h2 className="font-display text-lg sm:text-xl">Dossiers récents</h2>
                <Link to="/dossiers" className="text-sm text-primary hover:underline underline-offset-4 shrink-0">Tout voir →</Link>
              </div>
              {isLoadingDossiers ? (
                <Card className="divide-y overflow-hidden" aria-busy="true" aria-label="Chargement des dossiers">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                      <Skeleton className="h-1.5 w-full sm:w-44" />
                    </div>
                  ))}
                </Card>
              ) : dossiers.length === 0 ? (
                <Card className="p-8 text-center">
                  <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">Aucun dossier pour le moment.</p>
                  <Link to="/dossiers" className="text-sm text-primary hover:underline mt-2 inline-block">Créer un dossier</Link>
                </Card>
              ) : (
                <Card className="divide-y overflow-hidden">
                  {dossiers.slice(0, 5).map((d) => {
                    const tks = toTaches<any>(allTaches).filter((t: any) => t.dossier_id === d.id) as any;
                    // Source unique : même calcul dans le dashboard, la liste et le détail.
                    const av = computeAvancement(tks, d.statut);
                    return (
                      <Link
                        key={d.id}
                        to="/dossiers/$id"
                        params={{ id: d.id }}
                        className="block p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                              <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(d.categorie)}</span>
                              <StatusBadge statut={d.statut} />
                            </div>
                            <div className="font-medium truncate">{d.titre}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Mis à jour {formatDistanceToNow(new Date(d.updated_at), { addSuffix: true, locale: fr })}
                            </div>
                          </div>
                          <div className="w-full sm:w-44 shrink-0">
                            <div className="text-xs text-muted-foreground mb-1.5 whitespace-nowrap sm:text-right">{etapesLabel(tks)}</div>
                            <Progress value={av} className="h-1.5" />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </Card>
              )}
            </section>
          </div>

          <aside className="min-w-0 space-y-8">
            <section>
              <h2 className="font-display text-lg sm:text-xl mb-3">Vue d'ensemble</h2>
              <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border">
                <StatCell icon={FolderOpen} label="Dossiers" value={stats.total} />
                <StatCell icon={Clock} label="En attente" value={stats.enAttente} tone="warning" />
                <StatCell icon={FileText} label="En cours" value={stats.enCours} tone="info" />
                <StatCell icon={CheckCircle2} label="Validés" value={stats.valides} tone="success" />
              </Card>
            </section>

            {handled.length > 0 && (
              <section>
                <h2 className="font-display text-lg sm:text-xl mb-3">L'agence s'en occupe</h2>
                <Card className="p-4 bg-muted/30">
                  <ul className="text-sm space-y-2">
                    {handled.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                        <Link to="/dossiers/$id" params={{ id: d.id }} className="hover:underline underline-offset-4 truncate">
                          {d.titre}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground mt-3">Rien à faire de votre côté, vous serez notifié.</p>
                </Card>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function GuideStep({ n, icon: Icon, title, text }: { n: number; icon: any; title: string; text: string }) {
  return (
    <li className="flex gap-3 items-start">
      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{n}. {title}</div>
        <div className="text-xs text-muted-foreground">{text}</div>
      </div>
    </li>
  );
}


function StatCell({ icon: Icon, label, value, tone = "default" }: { icon: any; label: string; value: number; tone?: string }) {
  const colors: Record<string, string> = {
    default: "text-primary bg-primary/10",
    warning: "text-warning-foreground bg-warning/20",
    info: "text-info bg-info/10",
    success: "text-success bg-success/10",
  };
  return (
    <div className="bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={`h-6 w-6 rounded-md ${colors[tone]} flex items-center justify-center shrink-0`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
