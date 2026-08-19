import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/status-badge";
import { categorieLabel } from "@/lib/labels";
import { computeAvancement, etapesLabel, toTaches } from "@/lib/dossier-progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  FolderOpen, CheckCircle2, Circle, Loader2, Download, ArrowRight,
  PanelRightClose, PanelRightOpen, CalendarDays, Users,
} from "lucide-react";

const STORAGE_KEY = "conv-dossier-panel-open";

type PanelProps = { clientId: string; clientName?: string };

/** Panneau latéral (desktop) + tiroir (mobile) affichant le dossier du client. */
export function ConversationDossierPanel({ clientId, clientName }: PanelProps) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v !== null) setOpen(v === "1");
  }, []);

  const toggle = () => {
    setOpen((v) => {
      window.localStorage.setItem(STORAGE_KEY, v ? "0" : "1");
      return !v;
    });
  };

  if (!open) {
    return (
      <div className="hidden lg:flex flex-col items-center pt-2">
        <Button variant="outline" size="sm" onClick={toggle} title="Afficher le dossier">
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <aside className="hidden lg:block w-[340px] shrink-0">
      <DossierPanelContent clientId={clientId} clientName={clientName} onCollapse={toggle} />
    </aside>
  );
}

/** Bouton « Dossier » + tiroir, affiché sur mobile / petit écran. */
export function ConversationDossierDrawer({ clientId, clientName }: PanelProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <FolderOpen className="h-4 w-4 mr-1.5" /> Dossier
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
        <SheetHeader className="px-4 pt-4">
          <SheetTitle>Dossier du client</SheetTitle>
        </SheetHeader>
        <div className="p-4">
          <DossierPanelContent clientId={clientId} clientName={clientName} bare />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function fmt(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function DossierPanelContent({
  clientId,
  clientName,
  onCollapse,
  bare,
}: PanelProps & { onCollapse?: () => void; bare?: boolean }) {
  const { data: dossiers = [], isLoading } = useQuery({
    queryKey: ["conv-panel-dossiers", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("dossiers")
        .select("id, titre, categorie, statut, avancement, pole_id, responsable_id, created_at, updated_at, prochaine_action, organisme_nom")
        .eq("client_id", clientId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dossier = useMemo(
    () => dossiers.find((d) => d.id === selectedId) ?? dossiers[0] ?? null,
    [dossiers, selectedId],
  );

  const { data: tachesData } = useQuery({
    queryKey: ["conv-panel-taches", dossier?.id],
    enabled: !!dossier?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("taches")
        .select("id, titre, statut, ordre, assigne_id, completed_at, updated_at")
        .eq("dossier_id", dossier!.id)
        .order("ordre", { ascending: true });
      return toTaches<any>(data);
    },
  });

  const taches = toTaches<any>(tachesData);

  const { data: documents = [] } = useQuery({
    queryKey: ["conv-panel-docs", dossier?.id],
    enabled: !!dossier?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("documents")
        .select("id, nom, storage_path, created_at")
        .eq("dossier_id", dossier!.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const { data: pole } = useQuery({
    queryKey: ["conv-panel-pole", dossier?.pole_id],
    enabled: !!dossier?.pole_id,
    queryFn: async () =>
      (await supabase.from("poles").select("id, nom, couleur").eq("id", dossier!.pole_id).maybeSingle()).data,
  });

  const peopleIds = useMemo(() => {
    const ids = new Set<string>();
    if (dossier?.responsable_id) ids.add(dossier.responsable_id);
    for (const t of taches) if (t.assigne_id) ids.add(t.assigne_id);
    return Array.from(ids);
  }, [dossier?.responsable_id, taches]);

  const { data: people = {} } = useQuery({
    queryKey: ["conv-panel-people", peopleIds.join(",")],
    enabled: peopleIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, prenom, nom, email").in("id", peopleIds);
      const m: Record<string, string> = {};
      for (const p of (data ?? []) as any[]) {
        m[p.id] = `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email;
      }
      return m;
    },
  });

  const download = async (doc: any) => {
    if (!doc.storage_path) return toast.error("Aucun fichier attaché.");
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60, { download: doc.nom });
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const body = (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement du dossier…
        </div>
      ) : !dossier ? (
        <div className="text-center py-6 space-y-3">
          <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Aucun dossier rattaché</p>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/dossiers">Rattacher un dossier</Link>
          </Button>
        </div>
      ) : (
        <>
          {dossiers.length > 1 && (
            <Select value={dossier.id} onValueChange={setSelectedId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dossiers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.titre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div>
            {clientName && <div className="text-xs text-muted-foreground truncate">{clientName}</div>}
            <div className="font-display text-base leading-tight">{dossier.titre}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {categorieLabel(dossier.categorie)}
              {dossier.organisme_nom ? ` · ${dossier.organisme_nom}` : ""}
            </div>
          </div>

          <div>
            <StatusBadge statut={dossier.statut} />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{etapesLabel(taches as any)}</span>
              <span>{computeAvancement(taches as any, dossier.statut)}%</span>
            </div>
            <Progress value={computeAvancement(taches as any, dossier.statut)} className="h-2" />
          </div>

          <ol className="space-y-2">
            {taches.map((t) => {
              const done = t.statut === "termine";
              const encours = t.statut === "en_cours" || t.statut === "en_attente_client";
              return (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-success shrink-0" />
                  ) : encours ? (
                    <Loader2 className="h-4 w-4 mt-0.5 text-info shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className={cn("truncate", done && "text-muted-foreground line-through")}>{t.titre}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {done
                        ? `Terminée le ${fmt(t.completed_at ?? t.updated_at)}${t.assigne_id && people[t.assigne_id] ? ` · ${people[t.assigne_id]}` : ""}`
                        : encours
                          ? "En cours"
                          : "À faire"}
                    </div>
                  </div>
                </li>
              );
            })}
            {taches.length === 0 && (
              <li className="text-xs text-muted-foreground">Aucune étape définie.</li>
            )}
          </ol>

          <div className="rounded-lg border p-3 space-y-1.5 text-xs">
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Pôle :</span>
              {pole ? (
                <Badge
                  variant="outline"
                  style={{
                    color: pole.couleur,
                    borderColor: `color-mix(in oklab, ${pole.couleur} 35%, transparent)`,
                    backgroundColor: `color-mix(in oklab, ${pole.couleur} 12%, transparent)`,
                  }}
                >
                  {pole.nom}
                </Badge>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Responsable :</span>
              <span className="truncate">
                {dossier.responsable_id ? people[dossier.responsable_id] ?? "…" : "Non assigné"}
              </span>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Créé le</span>
              <span>{fmt(dossier.created_at)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground pl-5">Mis à jour</span>
              <span>{fmt(dossier.updated_at)}</span>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium mb-1.5">
              Documents ({documents.length})
            </div>
            {documents.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun document.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {documents.slice(0, 8).map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{d.nom}</div>
                      <div className="text-[11px] text-muted-foreground">{fmt(d.created_at)}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => download(d)} aria-label="Télécharger">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button asChild className="w-full" size="sm">
            <Link to="/dossiers/$id" params={{ id: dossier.id }}>
              Ouvrir le dossier complet <ArrowRight className="h-4 w-4 ml-1.5" />
            </Link>
          </Button>
        </>
      )}
    </div>
  );

  if (bare) return body;

  return (
    <Card className="p-4 lg:sticky lg:top-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-display text-sm uppercase tracking-wider text-muted-foreground">Dossier</h2>
        {onCollapse && (
          <Button variant="ghost" size="sm" onClick={onCollapse} title="Replier">
            <PanelRightClose className="h-4 w-4" />
          </Button>
        )}
      </div>
      {body}
    </Card>
  );
}
