import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ShieldCheck, Building2, Phone, Globe, Mail } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel } from "@/lib/labels";
import { DossierExternalChat } from "@/components/dossier-external-chat";
import { QualiopiRequestsPanel } from "@/components/qualiopi-requests-panel";
import { useScrollToHash } from "@/hooks/use-scroll-to-hash";

export const Route = createFileRoute("/_authenticated/audits/$id")({
  head: () => ({ meta: [{ title: "Dossier audité — IZISuivis" }] }),
  component: AuditDetail,
});

function AuditDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  useScrollToHash([id]);

  const { data: dossier, isLoading } = useQuery({
    queryKey: ["audit-dossier", id],
    queryFn: async () => {
      const { data } = await supabase.from("dossiers").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  if (!dossier) {
    return (
      <Card className="p-6 text-sm">
        Dossier introuvable ou hors de votre périmètre d'affectation.
        <div className="mt-3">
          <Link to="/audits" className="text-primary underline">Retour à mes dossiers</Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => nav({ to: "/audits" })}
        className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Mes dossiers affectés
      </button>

      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="text-xs uppercase tracking-wider text-gold font-medium">
                {categorieLabel(dossier.categorie)}
              </span>
              <StatusBadge statut={dossier.statut} />
            </div>
            <h1 className="font-display text-2xl">{dossier.titre}</h1>
            {(dossier as any).organisme_nom && (
              <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> {(dossier as any).organisme_nom}
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
              {(dossier as any).of_email && (
                <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {(dossier as any).of_email}</span>
              )}
              {(dossier as any).of_telephone && (
                <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {(dossier as any).of_telephone}</span>
              )}
              {(dossier as any).site_web && (
                <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {(dossier as any).site_web}</span>
              )}
            </div>
          </div>
          <Badge variant="outline">Avancement {dossier.avancement ?? 0}%</Badge>
        </div>
        {dossier.description && (
          <p className="text-sm text-muted-foreground mt-3 whitespace-pre-line">{dossier.description}</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div id="audit-chat" className="scroll-mt-20"><DossierExternalChat dossierId={id} /></div>
        <div id="qualiopi" className="scroll-mt-20"><QualiopiRequestsPanel dossierId={id} /></div>
      </div>
    </div>
  );
}
