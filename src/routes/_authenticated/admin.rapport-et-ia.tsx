import type { ReactNode } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrendingUp, FileText, Bot, ClipboardList, ShieldCheck } from "lucide-react";
import { DirectionDashboard } from "@/components/rapport-ia/direction-panel";
import { RapportsActivite } from "@/components/rapport-ia/rapports-activite-panel";
import { AgentIaPage } from "@/components/rapport-ia/agent-ia-panel";
import { Page as PiecesModeles } from "@/components/rapport-ia/pieces-modeles-panel";
import { AuditPage } from "@/components/rapport-ia/audit-panel";

const searchSchema = z.object({
  onglet: z
    .enum(["pilotage", "rapports", "agent-ia", "pieces", "audit"])
    .optional(),
});

export const Route = createFileRoute("/_authenticated/admin/rapport-et-ia")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Rapport et IA — IZISuivis" },
      { name: "description", content: "Pilotage, rapports d'activité, supervision IA, pièces attendues et journal d'audit." },
      { property: "og:title", content: "Rapport et IA — IZISuivis" },
      { property: "og:description", content: "Tableau de pilotage, rapports, supervision IA et journal d'audit d'IZISuivis." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Le moins restrictif des onglets : l'onglet « Pièces attendues » était
  // ouvert à tout utilisateur authentifié. Le droit réel est ensuite vérifié
  // onglet par onglet (voir TABS ci-dessous) — aucun accès n'est élargi.
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
  },
  component: RapportEtIaPage,
});

type TabKey = "pilotage" | "rapports" | "agent-ia" | "pieces" | "audit";

function RapportEtIaPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { onglet } = Route.useSearch();
  const role = useRole();

  // Droits repris à l'identique des cinq pages d'origine.
  const tabs: { key: TabKey; label: string; icon: any; allowed: boolean; render: () => ReactNode }[] = [
    { key: "pilotage", label: "Pilotage", icon: TrendingUp, allowed: role.isAdmin || role.isDirection, render: () => <DirectionDashboard /> },
    { key: "rapports", label: "Rapports d'activité", icon: FileText, allowed: role.isAdmin || role.isDirection, render: () => <RapportsActivite /> },
    { key: "agent-ia", label: "Agent IA", icon: Bot, allowed: role.isAdmin, render: () => <AgentIaPage /> },
    { key: "pieces", label: "Pièces attendues", icon: ClipboardList, allowed: true, render: () => <PiecesModeles /> },
    { key: "audit", label: "Journal d'audit", icon: ShieldCheck, allowed: role.isAdmin || role.isDirection, render: () => <AuditPage /> },
  ];

  const visible = tabs.filter((t) => t.allowed);

  if (role.loading) {
    return <div className="p-6 text-sm text-muted-foreground">Chargement…</div>;
  }

  if (visible.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Accès non autorisé.</div>;
  }

  const active = visible.some((t) => t.key === onglet) ? (onglet as TabKey) : visible[0]!.key;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Rapport et IA</h1>
        <p className="text-sm text-muted-foreground">
          Pilotage, rapports d'activité, supervision IA, pièces attendues et journal d'audit.
        </p>
      </div>

      <Tabs
        value={active}
        onValueChange={(v) => navigate({ to: ".", search: { onglet: v as TabKey } })}
        className="space-y-6"
      >
        <div className="-mx-2 overflow-x-auto px-2 pb-1">
          <TabsList className="inline-flex w-max">
            {visible.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-2 whitespace-nowrap">
                <t.icon className="h-4 w-4" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {visible.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-0">
            {active === t.key ? t.render() : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
