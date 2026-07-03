import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { CATEGORIES, categorieLabel } from "@/lib/labels";
import { computeNextAction } from "@/lib/next-action";
import { cn } from "@/lib/utils";
import { Plus, ArrowRight, Clock, CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dossiers/")({
  head: () => ({ meta: [{ title: "Mes dossiers" }] }),
  component: DossiersPage,
});

function DossiersPage() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const { data: poles = [] } = useQuery({
    queryKey: ["poles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("poles").select("id, code, nom").eq("actif", true).order("nom");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: dossiers = [], isLoading } = useQuery({
    queryKey: ["dossiers-mine", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const q = supabase.from("dossiers").select("*").order("updated_at", { ascending: false });
      const { data, error } = isAdmin ? await q : await q.eq("client_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (payload: {
      titre: string;
      categorie: string;
      pole_id: string;
      description: string;
      qualiopi_audit_type?: string | null;
      qualiopi_scopes?: string[];
      nb_stagiaires?: number | null;
      nb_formateurs?: number | null;
      nb_formations?: number | null;
      has_stagiaires?: boolean;
      stagiaires?: any[];
    }) => {
      const row: any = {
        client_id: user!.id,
        titre: payload.titre,
        categorie: payload.categorie as any,
        pole_id: payload.pole_id,
        description: payload.description || null,
      };
      if (payload.categorie === "qualiopi") {
        row.qualiopi_audit_type = payload.qualiopi_audit_type ?? null;
        row.qualiopi_scopes = payload.qualiopi_scopes ?? [];
        row.nb_stagiaires = payload.nb_stagiaires ?? null;
        row.nb_formateurs = payload.nb_formateurs ?? null;
        row.nb_formations = payload.nb_formations ?? null;
        row.has_stagiaires = !!payload.has_stagiaires;
        row.stagiaires = payload.stagiaires ?? [];
      }
      const { data, error } = await supabase.from("dossiers").insert(row).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Votre demande a été envoyée à l'agence");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["dossiers-mine"] });
      if (data?.id) navigate({ to: "/dossiers/$id", params: { id: data.id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Auto-map catégorie → pôle (par code, sinon premier pôle)
  const poleForCategorie = (cat: string) => {
    const byCode = poles.find((p: any) => p.code?.toLowerCase() === cat.toLowerCase());
    return byCode?.id ?? poles[0]?.id ?? "";
  };

  const submitAdmin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const titre = (fd.get("titre") as string)?.trim();
    const categorie = fd.get("categorie") as string;
    const pole_id = fd.get("pole_id") as string;
    const description = (fd.get("description") as string)?.trim() ?? "";
    if (!titre || !categorie || !pole_id) { toast.error("Champs requis" ); return; }
    create.mutate({ titre, categorie, pole_id, description });
  };

  const submitClient = (
    categorie: string,
    description: string,
    extra?: {
      qualiopi_audit_type?: string | null;
      qualiopi_scopes?: string[];
      nb_stagiaires?: number | null;
      nb_formateurs?: number | null;
      nb_formations?: number | null;
      has_stagiaires?: boolean;
      stagiaires?: any[];
      organisme_nom?: string;
    },
  ) => {
    const pole_id = poleForCategorie(categorie);
    if (!pole_id) { toast.error("Configuration indisponible, contactez l'agence"); return; }
    const label = categorieLabel(categorie);
    const organisme = extra?.organisme_nom?.trim();
    const titre = organisme ? `Demande ${label} - ${organisme}` : `Demande ${label}`;
    const { organisme_nom, ...rest } = extra ?? {};
    create.mutate({ titre, categorie, pole_id, description, ...rest });
  };

  const filtered = filter === "all" ? dossiers : dossiers.filter((d) => d.categorie === filter);

  const dossierIds = dossiers.map((d) => d.id);
  const { data: allDocs = [] } = useQuery({
    queryKey: ["dossiers-mine-docs", user?.id, dossierIds.join(",")],
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
    queryKey: ["dossiers-mine-taches", user?.id, dossierIds.join(",")],
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

  const displayedDossiers = isAdmin ? filtered : dossiers;

  const dossierWithAction = displayedDossiers.map((d) => {
    const na = computeNextAction(
      d.categorie,
      allDocs.filter((doc: any) => doc.dossier_id === d.id) as any,
      allTaches.filter((t: any) => t.dossier_id === d.id) as any,
      d.statut,
    );
    return { d, na };
  });

  const isDone = (s: string) => ["termine", "valide"].includes(s);
  const aFaire = dossierWithAction.filter(
    ({ d, na }) => !isDone(d.statut) && na.kind !== "aucune" && na.kind !== "attente_agence",
  );
  const enCours = dossierWithAction.filter(
    ({ d, na }) => !isDone(d.statut) && (na.kind === "aucune" || na.kind === "attente_agence"),
  );
  const termines = dossierWithAction.filter(({ d }) => isDone(d.statut));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Mes dossiers</h1>
          <p className="text-muted-foreground mt-1">
            {isAdmin ? "Suivez l'avancement et déposez vos pièces." : "Voici vos demandes, regroupées pour vous."}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> {isAdmin ? "Nouveau dossier" : "Faire une demande à l'agence"}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{isAdmin ? "Nouveau dossier" : "De quoi avez-vous besoin ?"}</DialogTitle>
              {!isAdmin && (
                <p className="text-sm text-muted-foreground pt-1">
                  Choisissez ce dont vous avez besoin. Si vous ne savez pas, sélectionnez « Je ne sais pas ».
                </p>
              )}
            </DialogHeader>
            {isAdmin ? (
              <form onSubmit={submitAdmin} className="space-y-4">
                <div>
                  <Label htmlFor="titre">Titre</Label>
                  <Input id="titre" name="titre" required maxLength={120} />
                </div>
                <div>
                  <Label>Pôle</Label>
                  <Select name="pole_id" required>
                    <SelectTrigger><SelectValue placeholder="Choisir un pôle…" /></SelectTrigger>
                    <SelectContent>
                      {poles.map((p) => <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Catégorie</Label>
                  <Select name="categorie" required>
                    <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="description">Description (optionnel)</Label>
                  <Textarea id="description" name="description" rows={3} maxLength={500} />
                </div>
                <Button type="submit" disabled={create.isPending} className="w-full">Créer le dossier</Button>
              </form>
            ) : (
              <ClientRequestWizard onSubmit={submitClient} pending={create.isPending} />
            )}
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">Chargement…</Card>
      ) : isAdmin ? (
        <>
          <div className="flex flex-wrap gap-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>Tous</FilterChip>
            {CATEGORIES.map((c) => (
              <FilterChip key={c.value} active={filter === c.value} onClick={() => setFilter(c.value)}>{c.label}</FilterChip>
            ))}
          </div>
          {filtered.length === 0 ? (
            <Card className="p-12 text-center"><p className="text-muted-foreground">Aucun dossier.</p></Card>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory items-start">
              <ClientSection
                title="À faire maintenant"
                subtitle="Ces dossiers attendent une action de votre part."
                icon={AlertCircle}
                tone="warning"
                items={aFaire}
                empty="Rien à faire pour le moment 🎉"
                className="w-full md:w-1/3 md:min-w-[320px] snap-start"
              />
              <ClientSection
                title="En cours avec l'agence"
                subtitle="L'agence s'occupe de ces dossiers. Vous serez notifié."
                icon={Clock}
                tone="info"
                items={enCours}
                empty="Aucun dossier en cours côté agence."
                className="w-full md:w-1/3 md:min-w-[320px] snap-start"
              />
              <ClientSection
                title="Terminés"
                subtitle="Vos dossiers finalisés."
                icon={CheckCircle2}
                tone="success"
                items={termines}
                empty="Aucun dossier terminé pour l'instant."
                className="w-full md:w-1/3 md:min-w-[320px] snap-start"
              />
            </div>
          )}
        </>
      ) : dossiers.length === 0 ? (
        <Card className="p-12 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">Vous n'avez pas encore de demande.</p>
          <button onClick={() => setOpen(true)} className="text-sm text-primary hover:underline mt-2">Faire une demande à l'agence</button>
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory items-start">
          <ClientSection
            title="À faire maintenant"
            subtitle="Ces dossiers attendent une action de votre part."
            icon={AlertCircle}
            tone="warning"
            items={aFaire}
            empty="Rien à faire pour le moment 🎉"
            className="w-full md:w-1/3 md:min-w-[320px] snap-start"
          />
          <ClientSection
            title="En cours avec l'agence"
            subtitle="L'agence s'occupe de ces dossiers. Vous serez notifié."
            icon={Clock}
            tone="info"
            items={enCours}
            empty="Aucun dossier en cours côté agence."
            className="w-full md:w-1/3 md:min-w-[320px] snap-start"
          />
          <ClientSection
            title="Terminés"
            subtitle="Vos dossiers finalisés."
            icon={CheckCircle2}
            tone="success"
            items={termines}
            empty="Aucun dossier terminé pour l'instant."
            className="w-full md:w-1/3 md:min-w-[320px] snap-start"
          />
        </div>
      )}
    </div>
  );
}

function ClientSection({
  title, subtitle, icon: Icon, tone, items, empty, className,
}: {
  title: string; subtitle: string; icon: any; tone: "warning" | "info" | "success";
  items: { d: any; na: ReturnType<typeof computeNextAction> }[]; empty: string; className?: string;
}) {
  const toneCls: Record<string, string> = {
    warning: "text-warning-foreground bg-warning/20 border-warning/20",
    info: "text-info bg-info/10 border-info/20",
    success: "text-success bg-success/10 border-success/20",
  };
  return (
    <section className={cn("flex flex-col min-w-0", className)}>
      <div className="flex items-center gap-3 mb-3 px-1">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center border ${toneCls[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg leading-tight">{title}</h2>
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {items.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{subtitle}</p>
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-3 bg-muted/40 rounded-xl p-3 border border-border/50 min-h-[300px]">
        {items.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground bg-background/60 border-dashed">{empty}</Card>
        ) : (
          items.map(({ d, na }) => {
            const isAutre = d.categorie === "autres";
            const catLabel = isAutre ? "Autre demande" : categorieLabel(d.categorie);
            const titre = isAutre ? "L'agence va vous aider à préciser votre besoin" : d.titre;
            return (
            <Link key={d.id} to="/dossiers/$id" params={{ id: d.id }} className="block group">
              <Card className="p-4 hover:border-primary/40 transition-colors bg-background">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wider text-gold font-medium">{catLabel}</div>
                    <div className={`mt-0.5 truncate ${isAutre ? "text-sm text-muted-foreground" : "font-medium"}`}>{titre}</div>
                  </div>
                  <StatusBadge statut={d.statut} />
                </div>
                {na.kind !== "aucune" && (
                  <div className="mt-2 rounded-lg border bg-muted/40 p-2.5">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Prochaine action</div>
                    <div className="text-sm font-medium mt-0.5">{na.label}</div>
                    {na.detail && <div className="text-xs text-muted-foreground mt-1">{na.detail}</div>}
                  </div>
                )}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Avancement</span><span>{d.avancement}%</span>
                  </div>
                  <Progress value={d.avancement} className="h-1.5" />
                </div>
                <div className="mt-3">
                  <span className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold group-hover:opacity-90">
                    Ouvrir ce dossier <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Card>
            </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

function FilterChip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/40"
      }`}
    >
      {children}
    </button>
  );
}

const CLIENT_NEEDS: { value: string; label: string; hint: string }[] = [
  { value: "qualiopi", label: "Certification Qualiopi", hint: "Pour obtenir ou renouveler votre certification qualité." },
  { value: "nda", label: "Demande de NDA", hint: "Pour obtenir votre numéro de déclaration d'activité." },
  { value: "edof", label: "Dossier EDOF / CPF", hint: "Pour les démarches Mon Compte Formation." },
  { value: "cfa", label: "Création ou gestion CFA", hint: "Pour créer ou suivre votre CFA." },
  { value: "bpf", label: "BPF annuel", hint: "Pour préparer votre bilan pédagogique et financier." },
  { value: "vae", label: "VAE", hint: "Pour une demande liée à la validation des acquis." },
  { value: "contrats", label: "Contrats", hint: "Pour les conventions, contrats ou documents à signer." },
  { value: "documents_administratifs", label: "Documents administratifs", hint: "Pour envoyer ou demander un document administratif." },
  { value: "autres", label: "Je ne sais pas / Autre demande", hint: "L'agence vous rappellera pour comprendre votre besoin." },
];

const QUALIOPI_AUDIT_TYPES = [
  { value: "nouvel_entrant", label: "Nouvel entrant", hint: "Première certification Qualiopi" },
  { value: "audit_surveillance", label: "Audit de surveillance", hint: "Audit intermédiaire (18 mois après la certification)" },
  { value: "renouvellement", label: "Renouvellement", hint: "Renouvellement de la certification (tous les 3 ans)" },
  { value: "complementaire", label: "Audit complémentaire", hint: "Ajout d'une nouvelle catégorie d'action" },
];

const QUALIOPI_SCOPES = [
  { value: "AF", label: "Actions de Formation (AF)" },
  { value: "BC", label: "Bilans de Compétences (BC)" },
  { value: "VAE", label: "Validation des Acquis (VAE)" },
  { value: "CFA", label: "Apprentissage / CFA" },
];

function ClientRequestWizard({
  onSubmit,
  pending,
}: {
  onSubmit: (
    categorie: string,
    description: string,
    extra?: {
      qualiopi_audit_type?: string | null;
      qualiopi_scopes?: string[];
      nb_stagiaires?: number | null;
      nb_formateurs?: number | null;
      nb_formations?: number | null;
      has_stagiaires?: boolean;
      stagiaires?: any[];
      organisme_nom?: string;
    },
  ) => void;
  pending: boolean;
}) {
  const [step, setStep] = useState(1);
  const [categorie, setCategorie] = useState<string>("");
  const [description, setDescription] = useState("");

  // Champs spécifiques Qualiopi
  const [organismeNom, setOrganismeNom] = useState<string>("");
  const [auditType, setAuditType] = useState<string>("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [nbStagiaires, setNbStagiaires] = useState<string>("");
  const [nbFormateurs, setNbFormateurs] = useState<string>("");
  const [nbFormations, setNbFormations] = useState<string>("");
  const [hasStagiaires, setHasStagiaires] = useState<boolean>(false);
  const [stagiaires, setStagiaires] = useState<Array<{
    nom: string; prenom: string; email: string; telephone: string; formation: string; date_debut: string; date_fin: string;
  }>>([]);

  const isQualiopi = categorie === "qualiopi";
  const toggleScope = (v: string) =>
    setScopes((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));

  const addStagiaire = () =>
    setStagiaires((l) => [...l, { nom: "", prenom: "", email: "", telephone: "", formation: "", date_debut: "", date_fin: "" }]);
  const updateStagiaire = (i: number, patch: Partial<(typeof stagiaires)[number]>) =>
    setStagiaires((l) => l.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeStagiaire = (i: number) =>
    setStagiaires((l) => l.filter((_, idx) => idx !== i));

  const canSubmitQualiopi = isQualiopi && organismeNom.trim().length > 0 && auditType && scopes.length > 0;

  const submitQualiopi = () => {
    const toInt = (s: string) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    onSubmit(categorie, description.trim(), {
      qualiopi_audit_type: auditType || null,
      qualiopi_scopes: scopes,
      nb_stagiaires: toInt(nbStagiaires),
      nb_formateurs: toInt(nbFormateurs),
      nb_formations: toInt(nbFormations),
      has_stagiaires: hasStagiaires,
      stagiaires: hasStagiaires ? stagiaires : [],
      organisme_nom: organismeNom.trim(),
    });
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {step === 1 && (
        <div className="space-y-3">
          <div>
            <div className="font-medium">Quel est votre besoin ?</div>
            <p className="text-sm text-muted-foreground">Choisissez la demande qui correspond le mieux.</p>
          </div>
          <div className="grid gap-2">
            {CLIENT_NEEDS.map((n) => (
              <button
                key={n.value}
                type="button"
                onClick={() => setCategorie(n.value)}
                className={`text-left rounded-lg border p-3 hover:border-primary/60 hover:bg-muted/40 transition-colors ${
                  categorie === n.value ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div className="font-medium">{n.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{n.hint}</div>
              </button>
            ))}
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={!categorie}
            onClick={() => setStep(2)}
          >
            Continuer
          </Button>
        </div>
      )}


      {step === 2 && isQualiopi && (
        <div className="space-y-4">
          <div>
            <Label htmlFor="organisme-nom">Nom de l'organisme de formation <span className="text-destructive">*</span></Label>
            <Input
              id="organisme-nom"
              value={organismeNom}
              onChange={(e) => setOrganismeNom(e.target.value)}
              placeholder="Ex : Mon Centre de Formation"
              maxLength={120}
              required
            />
          </div>
          <div>
            <div className="font-medium">Type d'audit Qualiopi</div>
            <p className="text-sm text-muted-foreground">Sélectionnez le type qui vous concerne.</p>
          </div>
          <div className="grid gap-2">
            {QUALIOPI_AUDIT_TYPES.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setAuditType(a.value)}
                className={`text-left rounded-lg border p-3 hover:border-primary/60 hover:bg-muted/40 transition-colors ${
                  auditType === a.value ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div className="font-medium">{a.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{a.hint}</div>
              </button>
            ))}
          </div>

          <div className="pt-2">
            <div className="font-medium">Périmètre concerné</div>
            <p className="text-sm text-muted-foreground">Cochez toutes les catégories concernées.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {QUALIOPI_SCOPES.map((s) => {
              const active = scopes.includes(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleScope(s.value)}
                  className={`text-left rounded-lg border p-3 hover:border-primary/60 transition-colors ${
                    active ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div className="text-sm font-medium">{s.label}</div>
                </button>
              );
            })}
          </div>

          <div className="pt-2">
            <div className="font-medium">Informations sur vos stagiaires</div>
            <p className="text-sm text-muted-foreground">Estimations, pour préparer votre dossier.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="nb-stg">Stagiaires / an</Label>
              <Input id="nb-stg" type="number" min={0} value={nbStagiaires}
                onChange={(e) => setNbStagiaires(e.target.value)} placeholder="Ex : 30" />
            </div>
            <div>
              <Label htmlFor="nb-form">Formateurs</Label>
              <Input id="nb-form" type="number" min={0} value={nbFormateurs}
                onChange={(e) => setNbFormateurs(e.target.value)} placeholder="Ex : 2" />
            </div>
            <div>
              <Label htmlFor="nb-fo">Formations</Label>
              <Input id="nb-fo" type="number" min={0} value={nbFormations}
                onChange={(e) => setNbFormations(e.target.value)} placeholder="Ex : 5" />
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={hasStagiaires}
                onChange={(e) => {
                  const c = e.target.checked;
                  setHasStagiaires(c);
                  if (c && stagiaires.length === 0) addStagiaire();
                }}
              />
              <span className="text-sm font-medium">Avez-vous un stagiaire à déclarer&nbsp;?</span>
            </label>
          </div>

          {hasStagiaires && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Informations du/des stagiaire(s)</div>
                <Button type="button" size="sm" variant="outline" onClick={addStagiaire}>
                  + Ajouter
                </Button>
              </div>
              {stagiaires.map((s, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">Stagiaire #{i + 1}</div>
                    {stagiaires.length > 1 && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeStagiaire(i)}>
                        Supprimer
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Nom</Label>
                      <Input value={s.nom} onChange={(e) => updateStagiaire(i, { nom: e.target.value })} />
                    </div>
                    <div>
                      <Label>Prénom</Label>
                      <Input value={s.prenom} onChange={(e) => updateStagiaire(i, { prenom: e.target.value })} />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input type="email" value={s.email} onChange={(e) => updateStagiaire(i, { email: e.target.value })} />
                    </div>
                    <div>
                      <Label>Téléphone</Label>
                      <Input value={s.telephone} onChange={(e) => updateStagiaire(i, { telephone: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>Formation suivie</Label>
                      <Input value={s.formation} onChange={(e) => updateStagiaire(i, { formation: e.target.value })} />
                    </div>
                    <div>
                      <Label>Date de début</Label>
                      <Input type="date" value={s.date_debut} onChange={(e) => updateStagiaire(i, { date_debut: e.target.value })} />
                    </div>
                    <div>
                      <Label>Date de fin</Label>
                      <Input type="date" value={s.date_fin} onChange={(e) => updateStagiaire(i, { date_fin: e.target.value })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <Label htmlFor="msg">Message complémentaire (optionnel)</Label>
            <Textarea
              id="msg"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Précisez votre contexte, votre échéance, etc."
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => setStep(1)}>Retour</Button>
            <Button
              type="button"
              className="flex-1"
              disabled={pending || !canSubmitQualiopi}
              onClick={submitQualiopi}
            >
              {pending ? "Envoi…" : "Envoyer ma demande à l'agence"}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && !isQualiopi && (
        <div className="space-y-3">
          <div>
            <div className="font-medium">Expliquez votre demande en une phrase</div>
            <p className="text-sm text-muted-foreground">Ex : « Je souhaite obtenir mon NDA pour mon organisme. »</p>
          </div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Votre message pour l'agence…"
          />
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => setStep(1)}>Retour</Button>
            <Button
              type="button"
              className="flex-1"
              disabled={pending}
              onClick={() => onSubmit(categorie, description.trim())}
            >
              {pending ? "Envoi…" : "Envoyer ma demande à l'agence"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

