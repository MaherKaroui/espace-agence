import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, FolderOpen, CheckCircle2, AlertTriangle, Circle, ClipboardCheck } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel, CATEGORIES, requiredDocsFor, docMatches } from "@/lib/labels";
import { cn } from "@/lib/utils";

type DocRow = {
  id: string;
  dossier_id: string;
  nom: string;
  detected_type: string | null;
  statut: string | null;
};

type ReviewStats = {
  total: number;
  validated: number;
  toReview: number; // envoyé, en attente de revue
  toFix: number;    // refusé ou à corriger
  missing: number;  // pas de fichier
  needsAction: boolean; // toReview + toFix + missing > 0
};

function computeReviewStats(categorie: string, docs: DocRow[]): ReviewStats {
  const requis = requiredDocsFor(categorie);
  if (requis.length === 0) {
    return { total: 0, validated: 0, toReview: 0, toFix: 0, missing: 0, needsAction: false };
  }
  let validated = 0, toReview = 0, toFix = 0, missing = 0;
  for (const r of requis) {
    const found = docs.find((d) => docMatches(d, r));
    if (!found) { missing++; continue; }
    const s = found.statut ?? "en_attente";
    if (s === "accepte") validated++;
    else if (s === "a_corriger" || s === "refuse") toFix++;
    else toReview++;
  }
  return {
    total: requis.length,
    validated, toReview, toFix, missing,
    needsAction: toReview + toFix + missing > 0,
  };
}

// Un dossier est "incohérent" si :
// - marqué terminé alors qu'il reste des pièces à valider
// - avancement = 0 alors que des documents sont acceptés
// - documents en attente/à corriger alors qu'aucun n'est encore accepté depuis longtemps (>7j)
type Inconsistency = "done_incomplete" | "zero_but_validated" | null;
function detectInconsistency(dossier: any, stats: ReviewStats | undefined): Inconsistency {
  if (!stats) return null;
  if (["termine", "valide"].includes(dossier.statut) && stats.needsAction) return "done_incomplete";
  if ((dossier.avancement ?? 0) === 0 && stats.validated > 0) return "zero_but_validated";
  return null;
}


export const Route = createFileRoute("/_authenticated/admin/dossiers")({
  head: () => ({ meta: [{ title: "Dossiers — Admin" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => ["admin","direction","manager","consultant"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminDossiers,
});


type QualityFilter =
  | "all"
  | "to_fix"
  | "missing"
  | "to_review"
  | "done_incomplete"
  | "zero_but_validated";

function AdminDossiers() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [quality, setQuality] = useState<QualityFilter>("all");
  const { user } = useAuth();
  const { isDirectionOrAdmin } = useRole();



  const { data: myPoleIds, isLoading: polesLoading } = useQuery({
    queryKey: ["my-pole-ids", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pole_members")
        .select("pole_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.pole_id);
    },
  });

  const { data: allPoles = [] } = useQuery({
    queryKey: ["admin-dossiers-poles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("poles")
        .select("id, code, nom, couleur, actif")
        .eq("actif", true)
        .order("nom");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Direction/Admin voient tous les pôles ; le reste du staff : uniquement leurs pôles.
  const poles = isDirectionOrAdmin
    ? allPoles
    : allPoles.filter((p) => (myPoleIds ?? []).includes(p.id));

  const { data: rows = [] } = useQuery({
    queryKey: ["admin-dossiers"],
    queryFn: async () => {
      const { data: dossiers, error } = await supabase
        .from("dossiers")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const dossierRows = dossiers ?? [];
      const clientIds = [...new Set(dossierRows.map((d: any) => d.client_id).filter(Boolean))];

      if (clientIds.length === 0) return dossierRows;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, nom, prenom, email")
        .in("id", clientIds);

      const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      return dossierRows.map((d: any) => ({
        ...d,
        profiles: profileById.get(d.client_id) ?? null,
      }));
    },
  });

  const dossierIds = useMemo(() => (rows as any[]).map((d) => d.id), [rows]);

  const { data: docsByDossier = {} } = useQuery({
    queryKey: ["admin-dossiers-docs", dossierIds.join(",")],
    enabled: dossierIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, dossier_id, nom, detected_type, statut")
        .in("dossier_id", dossierIds);
      if (error) throw error;
      const m: Record<string, DocRow[]> = {};
      for (const d of (data ?? []) as DocRow[]) {
        (m[d.dossier_id] ??= []).push(d);
      }
      return m;
    },
  });

  const statsById = useMemo(() => {
    const m: Record<string, ReviewStats> = {};
    for (const d of rows as any[]) {
      m[d.id] = computeReviewStats(d.categorie, (docsByDossier as any)[d.id] ?? []);
    }
    return m;
  }, [rows, docsByDossier]);

  const inconsistencyById = useMemo(() => {
    const m: Record<string, Inconsistency> = {};
    for (const d of rows as any[]) {
      m[d.id] = detectInconsistency(d, statsById[d.id]);
    }
    return m;
  }, [rows, statsById]);

  const filtered = (rows as any[]).filter((r: any) => {
    if (cat !== "all" && r.categorie !== cat) return false;
    if (reviewOnly && !statsById[r.id]?.needsAction) return false;
    const s = statsById[r.id];
    switch (quality) {
      case "to_fix": if (!s || s.toFix === 0) return false; break;
      case "missing": if (!s || s.missing === 0) return false; break;
      case "to_review": if (!s || s.toReview === 0) return false; break;
      case "done_incomplete": if (inconsistencyById[r.id] !== "done_incomplete") return false; break;
      case "zero_but_validated": if (inconsistencyById[r.id] !== "zero_but_validated") return false; break;
    }
    if (!q.trim()) return true;
    const txt = `${r.titre} ${r.profiles?.email ?? ""} ${r.profiles?.nom ?? ""} ${r.profiles?.prenom ?? ""}`.toLowerCase();
    return txt.includes(q.toLowerCase());
  });


  // Regroupement par pôle
  const groups: { pole: any; items: any[] }[] = poles.map((p) => ({
    pole: p,
    items: filtered.filter((d: any) => d.pole_id === p.id),
  }));
  // Les dossiers "orphelins" (sans pôle actif) ne sont montrés qu'aux direction/admin.
  if (isDirectionOrAdmin) {
    const orphelins = filtered.filter((d: any) => !poles.some((p) => p.id === d.pole_id));
    if (orphelins.length > 0) {
      groups.push({ pole: { id: "_orphelins", nom: "Sans pôle actif", couleur: "gray" }, items: orphelins });
    }
  }

  const visibleGroups = groups.filter((g) => g.items.length > 0);

  const totalToReview = (rows as any[]).reduce((n, d) => n + (statsById[d.id]?.needsAction ? 1 : 0), 0);
  const inconsistencies = (rows as any[]).filter((d) => inconsistencyById[d.id]);
  const doneIncompleteCount = inconsistencies.filter((d) => inconsistencyById[d.id] === "done_incomplete").length;
  const zeroValidatedCount = inconsistencies.filter((d) => inconsistencyById[d.id] === "zero_but_validated").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Dossiers de mes pôles</h1>
        <p className="text-muted-foreground mt-1">
          {filtered.length} dossier{filtered.length > 1 ? "s" : ""} · {visibleGroups.length} pôle{visibleGroups.length > 1 ? "s" : ""}
          {totalToReview > 0 && (
            <> · <span className="text-warning-foreground font-medium">{totalToReview} à revoir</span></>
          )}
        </p>
      </div>

      {inconsistencies.length > 0 && (
        <Card className="p-4 border-destructive/30 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <div className="font-medium text-sm">Alertes qualité ({inconsistencies.length})</div>
              <ul className="text-sm text-muted-foreground space-y-1">
                {doneIncompleteCount > 0 && (
                  <li>
                    <button className="text-destructive hover:underline" onClick={() => setQuality("done_incomplete")}>
                      {doneIncompleteCount} dossier{doneIncompleteCount > 1 ? "s" : ""} marqué{doneIncompleteCount > 1 ? "s" : ""} terminé{doneIncompleteCount > 1 ? "s" : ""} avec pièces non validées
                    </button>
                  </li>
                )}
                {zeroValidatedCount > 0 && (
                  <li>
                    <button className="text-destructive hover:underline" onClick={() => setQuality("zero_but_validated")}>
                      {zeroValidatedCount} dossier{zeroValidatedCount > 1 ? "s" : ""} à 0% mais avec documents validés
                    </button>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">Toutes catégories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as QualityFilter)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Tous les états</option>
          <option value="to_fix">Documents à corriger / refusés</option>
          <option value="missing">Documents manquants</option>
          <option value="to_review">Documents à vérifier</option>
          <option value="done_incomplete">Terminés incomplets</option>
          <option value="zero_but_validated">0% mais validés</option>
        </select>
        <button
          type="button"
          onClick={() => setReviewOnly((v) => !v)}
          className={cn(
            "h-10 px-3 rounded-md border text-sm inline-flex items-center gap-2 transition-colors",
            reviewOnly
              ? "bg-warning/15 border-warning/30 text-warning-foreground"
              : "bg-background border-input hover:bg-muted/50",
          )}
          aria-pressed={reviewOnly}
        >
          <ClipboardCheck className="h-4 w-4" />
          {reviewOnly ? "À revoir uniquement" : "À revoir"}
        </button>
      </div>


      {polesLoading && !isDirectionOrAdmin ? (
        <Card className="p-12 text-center text-muted-foreground text-sm">Chargement de vos pôles…</Card>
      ) : visibleGroups.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground text-sm">
          {reviewOnly
            ? "Aucun dossier à revoir — tous les documents requis sont validés."
            : "Aucun dossier accessible dans vos pôles pour le moment."}
        </Card>
      ) : (
        <div className="space-y-6">
          {visibleGroups.map(({ pole, items }) => {
            const groupToReview = items.reduce((n: number, d: any) => n + (statsById[d.id]?.needsAction ? 1 : 0), 0);
            return (
            <section key={pole.id} className="space-y-2">
              <div className="flex items-center gap-2 px-1 flex-wrap">
                <FolderOpen className="h-4 w-4 text-gold" />
                <h2 className="font-display text-lg">{pole.nom}</h2>
                <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {items.length}
                </span>
                {groupToReview > 0 && (
                  <Badge variant="outline" className="bg-warning/15 border-warning/30 text-warning-foreground text-xs">
                    {groupToReview} à revoir
                  </Badge>
                )}
              </div>
              <Card className="divide-y">
                {items.map((d: any) => {
                  const stats = statsById[d.id];
                  const inc = inconsistencyById[d.id];
                  return (
                  <Link key={d.id} to="/dossiers/$id" params={{ id: d.id }} className="block p-4 hover:bg-muted/30">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(d.categorie)}</span>
                          <StatusBadge statut={d.statut} />
                          <ReviewSummary stats={stats} />
                          {inc === "done_incomplete" && (
                            <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 text-xs gap-1">
                              <AlertTriangle className="h-3 w-3" /> Terminé incomplet
                            </Badge>
                          )}
                          {inc === "zero_but_validated" && (
                            <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 text-xs gap-1">
                              <AlertTriangle className="h-3 w-3" /> 0% mais validés
                            </Badge>
                          )}
                        </div>
                        <div className="font-medium truncate">{d.titre}</div>
                        <div className="text-xs text-muted-foreground">
                          {d.profiles?.prenom} {d.profiles?.nom} · {d.profiles?.email} · {d.avancement}%
                        </div>
                      </div>
                    </div>
                  </Link>
                  );
                })}

              </Card>
            </section>
            );
          })}
        </div>
      )}
    </div>

  );
}

function ReviewSummary({ stats }: { stats: ReviewStats | undefined }) {
  if (!stats || stats.total === 0) return null;
  const { total, validated, toReview, toFix, missing } = stats;
  if (validated === total) {
    return (
      <Badge variant="outline" className="bg-success/15 text-success border-success/20 text-xs gap-1">
        <CheckCircle2 className="h-3 w-3" /> {validated}/{total} validés
      </Badge>
    );
  }
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Badge variant="outline" className="bg-muted text-muted-foreground text-xs gap-1">
        {validated}/{total}
      </Badge>
      {toReview > 0 && (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 text-xs gap-1">
          <Circle className="h-3 w-3" /> {toReview} à vérifier
        </Badge>
      )}
      {toFix > 0 && (
        <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/20 text-xs gap-1">
          <AlertTriangle className="h-3 w-3" /> {toFix} à corriger
        </Badge>
      )}
      {missing > 0 && (
        <Badge variant="outline" className="bg-warning/15 text-warning-foreground border-warning/30 text-xs gap-1">
          {missing} manquant{missing > 1 ? "s" : ""}
        </Badge>
      )}
    </div>
  );
}

