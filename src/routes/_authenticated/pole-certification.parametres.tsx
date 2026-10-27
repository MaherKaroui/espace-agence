import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, FlaskConical, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { addDaysIso, todayIso, type PcEtape, type PcEtapeModele, type PcPieceType, type PcType } from "@/lib/pole-certification";
import { PC_ALL_KEY } from "@/components/pole-certification/use-pc";

const db = supabase as any;

export const Route = createFileRoute("/_authenticated/pole-certification/parametres")({
  head: () => ({ meta: [{ title: "Paramètres — Pôle Certification & EDOF" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => r.role === "admin" || r.role === "direction");
    if (!ok) throw redirect({ to: "/pole-certification" });
  },
  component: PcParametres,
});

function PcParametres() {
  return (
    <div className="space-y-4">
      <div>
        <Link to="/pole-certification" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Pôle Certification &amp; EDOF
        </Link>
        <h1 className="font-display text-2xl md:text-3xl mt-1">Paramètres du pôle</h1>
        <p className="text-sm text-muted-foreground">Étapes types, délais de relance, canaux et types de pièces — sans redéveloppement.</p>
      </div>
      <Tabs defaultValue="certificateur">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="certificateur">Étapes Certificateur</TabsTrigger>
          <TabsTrigger value="edof">Étapes EDOF</TabsTrigger>
          <TabsTrigger value="pieces">Types de pièces</TabsTrigger>
          <TabsTrigger value="demo">Version de test</TabsTrigger>
        </TabsList>
        <TabsContent value="certificateur"><EtapesModeles type="certificateur" /></TabsContent>
        <TabsContent value="edof"><EtapesModeles type="edof" /></TabsContent>
        <TabsContent value="pieces"><PieceTypes /></TabsContent>
        <TabsContent value="demo"><DemoCard /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------- Étapes types
function EtapesModeles({ type }: { type: PcType }) {
  const qc = useQueryClient();
  const key = ["pc-etape-modeles", type];
  const { data: modeles = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db.from("pc_etape_modeles").select("*").eq("dossier_type", type).order("ordre");
      if (error) throw error;
      return (data ?? []) as PcEtapeModele[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: async () => {
      const ordre = modeles.length ? Math.max(...modeles.map((m) => m.ordre)) + 1 : type === "edof" ? 0 : 1;
      const { error } = await db.from("pc_etape_modeles").insert({ dossier_type: type, ordre, intitule: "Nouvelle étape" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Étape ajoutée"); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  // Échange l'ordre de deux étapes voisines.
  const move = useMutation({
    mutationFn: async ({ a, b }: { a: PcEtapeModele; b: PcEtapeModele }) => {
      const r1 = await db.from("pc_etape_modeles").update({ ordre: b.ordre }).eq("id", a.id);
      if (r1.error) throw r1.error;
      const r2 = await db.from("pc_etape_modeles").update({ ordre: a.ordre }).eq("id", b.id);
      if (r2.error) throw r2.error;
    },
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <div className="space-y-3">
      <Card className="p-3 text-sm text-muted-foreground">
        Ces étapes s'appliquent aux <strong>nouveaux dossiers</strong>. Les dossiers existants gardent leurs étapes, modifiables depuis leur fiche.
        Délais par défaut proposés par le cahier des charges : relance à 7 et 15 jours — à ajuster selon votre expérience.
      </Card>
      {isLoading ? <Card className="p-6 text-sm text-muted-foreground">Chargement…</Card> : modeles.map((m, i) => (
        <ModeleRow
          key={m.id}
          modele={m}
          onUp={i > 0 ? () => move.mutate({ a: m, b: modeles[i - 1] }) : undefined}
          onDown={i < modeles.length - 1 ? () => move.mutate({ a: m, b: modeles[i + 1] }) : undefined}
          onSaved={refresh}
        />
      ))}
      <Button variant="outline" onClick={() => add.mutate()} disabled={add.isPending}><Plus className="h-4 w-4 mr-1" /> Ajouter une étape</Button>
    </div>
  );
}

const intOrNull = (v: string) => (v.trim() === "" ? null : Math.max(1, parseInt(v, 10) || 1));

function ModeleRow({ modele, onUp, onDown, onSaved }: { modele: PcEtapeModele; onUp?: () => void; onDown?: () => void; onSaved: () => void }) {
  const [f, setF] = useState(modele);
  const [checklist, setChecklist] = useState(modele.checklist.join("\n"));
  useEffect(() => { setF(modele); setChecklist(modele.checklist.join("\n")); }, [modele]);
  const set = (patch: Partial<PcEtapeModele>) => setF((x) => ({ ...x, ...patch }));

  const save = useMutation({
    mutationFn: async () => {
      if (!f.intitule.trim()) throw new Error("L'intitulé est obligatoire");
      const { error } = await db.from("pc_etape_modeles").update({
        intitule: f.intitule.trim(),
        a_saisir: f.a_saisir?.trim() || null,
        relance_jours: f.relance_jours,
        en_cours_max_jours: f.en_cours_max_jours,
        event_kind: f.event_kind,
        lien_expiration: f.lien_expiration,
        bloque_si_piece_perimee: f.bloque_si_piece_perimee,
        collecte_pieces: f.collecte_pieces,
        checklist: checklist.split("\n").map((l) => l.trim()).filter(Boolean),
        email_actif: f.email_actif,
        actif: f.actif,
      }).eq("id", modele.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Étape enregistrée"); onSaved(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <Card className={`p-4 space-y-3 ${f.actif ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono">N° {modele.ordre}</Badge>
        <Input className="flex-1 min-w-[200px]" value={f.intitule} onChange={(e) => set({ intitule: e.target.value })} aria-label="Intitulé" />
        <Button size="icon" variant="ghost" disabled={!onUp} onClick={onUp} aria-label="Monter"><ArrowUp className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" disabled={!onDown} onClick={onDown} aria-label="Descendre"><ArrowDown className="h-4 w-4" /></Button>
      </div>
      <div className="grid gap-1.5">
        <Label>À saisir / joindre</Label>
        <Textarea rows={2} value={f.a_saisir ?? ""} onChange={(e) => set({ a_saisir: e.target.value })} />
      </div>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label>Relance si pas de réponse (jours)</Label>
          <Input type="number" min={1} value={f.relance_jours ?? ""} onChange={(e) => set({ relance_jours: intOrNull(e.target.value) })} placeholder="Aucune" />
        </div>
        <div className="grid gap-1.5">
          <Label>Rappel si « En cours » plus de (jours)</Label>
          <Input type="number" min={1} value={f.en_cours_max_jours ?? ""} onChange={(e) => set({ en_cours_max_jours: intOrNull(e.target.value) })} placeholder="Aucun" />
        </div>
        <div className="grid gap-1.5">
          <Label>RDV daté (rappel veille + 1 h)</Label>
          <Select value={f.event_kind ?? "none"} onValueChange={(v) => set({ event_kind: v === "none" ? null : (v as "visio" | "webinaire") })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Aucun</SelectItem>
              <SelectItem value="visio">Visio</SelectItem>
              <SelectItem value="webinaire">Webinaire</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Cases à cocher (une par ligne)</Label>
        <Textarea rows={3} value={checklist} onChange={(e) => setChecklist(e.target.value)} placeholder="Société&#10;Dirigeants&#10;Offre" />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Toggle label="Date d'expiration du lien / code" checked={f.lien_expiration} onChange={(v) => set({ lien_expiration: v })} />
        <Toggle label="Bloquer si une pièce est périmée" checked={f.bloque_si_piece_perimee} onChange={(v) => set({ bloque_si_piece_perimee: v })} />
        <Toggle label="Étape de collecte des pièces" checked={f.collecte_pieces} onChange={(v) => set({ collecte_pieces: v })} />
        <Toggle label="Canal mail (en plus de la notification)" checked={f.email_actif} onChange={(v) => set({ email_actif: v })} />
        <Toggle label="Active" checked={f.actif} onChange={(v) => set({ actif: v })} />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4 mr-1" /> Enregistrer</Button>
      </div>
    </Card>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- Types de pièces
function PieceTypes() {
  const qc = useQueryClient();
  const { data: types = [], isLoading } = useQuery({
    queryKey: ["pc-piece-types"],
    queryFn: async () => {
      const { data, error } = await db.from("pc_piece_types").select("*").order("ordre");
      if (error) throw error;
      return (data ?? []) as PcPieceType[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["pc-piece-types"] });
  const add = useMutation({
    mutationFn: async () => {
      const ordre = types.length ? Math.max(...types.map((t) => t.ordre)) + 1 : 1;
      const { error } = await db.from("pc_piece_types").insert({ code: `piece_${Date.now()}`, libelle: "Nouvelle pièce", validite_jours: 90, ordre });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Type de pièce ajouté"); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <div className="space-y-3">
      <Card className="p-3 text-sm text-muted-foreground">
        La date de péremption est calculée seule : date d'émission + validité. Laisser la validité vide pour une pièce sans péremption.
        Les pièces « obligatoires » forment la check-list du dossier (en rouge si elles manquent).
      </Card>
      {isLoading ? <Card className="p-6 text-sm text-muted-foreground">Chargement…</Card> : types.map((t) => <PieceTypeRow key={t.id} piece={t} onSaved={refresh} />)}
      <Button variant="outline" onClick={() => add.mutate()} disabled={add.isPending}><Plus className="h-4 w-4 mr-1" /> Ajouter un type de pièce</Button>
    </div>
  );
}

function PieceTypeRow({ piece, onSaved }: { piece: PcPieceType; onSaved: () => void }) {
  const [f, setF] = useState(piece);
  useEffect(() => setF(piece), [piece]);
  const set = (patch: Partial<PcPieceType>) => setF((x) => ({ ...x, ...patch }));
  const toggleType = (t: PcType, on: boolean) =>
    set({ dossier_types: on ? Array.from(new Set([...f.dossier_types, t])) : f.dossier_types.filter((x) => x !== t) });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.libelle.trim() || !f.code.trim()) throw new Error("Libellé et code obligatoires");
      const { error } = await db.from("pc_piece_types").update({
        code: f.code.trim(), libelle: f.libelle.trim(), aide: f.aide?.trim() || null, validite_jours: f.validite_jours,
        dossier_types: f.dossier_types, obligatoire: f.obligatoire, actif: f.actif,
      }).eq("id", piece.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Type de pièce enregistré"); onSaved(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("pc_piece_types").delete().eq("id", piece.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Type de pièce supprimé (les pièces déjà déposées sont conservées)"); onSaved(); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <Card className={`p-4 space-y-3 ${f.actif ? "" : "opacity-60"}`}>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-[2fr_1fr_1fr]">
        <div className="grid gap-1.5"><Label>Libellé</Label><Input value={f.libelle} onChange={(e) => set({ libelle: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label>Code</Label><Input value={f.code} onChange={(e) => set({ code: e.target.value })} className="font-mono" /></div>
        <div className="grid gap-1.5">
          <Label>Validité (jours)</Label>
          <Input type="number" min={1} value={f.validite_jours ?? ""} placeholder="Sans péremption" onChange={(e) => set({ validite_jours: intOrNull(e.target.value) })} />
        </div>
      </div>
      <div className="grid gap-1.5"><Label>Aide</Label><Input value={f.aide ?? ""} onChange={(e) => set({ aide: e.target.value })} /></div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <Toggle label="Dossiers Certificateur" checked={f.dossier_types.includes("certificateur")} onChange={(v) => toggleType("certificateur", v)} />
        <Toggle label="Dossiers EDOF" checked={f.dossier_types.includes("edof")} onChange={(v) => toggleType("edof", v)} />
        <Toggle label="Obligatoire" checked={f.obligatoire} onChange={(v) => set({ obligatoire: v })} />
        <Toggle label="Actif" checked={f.actif} onChange={(v) => set({ actif: v })} />
        <div className="ml-auto flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild><Button size="sm" variant="ghost" className="text-destructive"><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer ce type de pièce ?</AlertDialogTitle>
                <AlertDialogDescription>Les pièces déjà déposées restent dans les dossiers. Préférez « Actif : non » pour le masquer seulement.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove.mutate()}>Supprimer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4 mr-1" /> Enregistrer</Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Version de test
const DEMO_PREFIX = "[DÉMO]";

async function demoEtapes(dossierId: string) {
  const { data, error } = await db.from("pc_etapes").select("*").eq("dossier_id", dossierId).eq("remplacee", false).order("ordre");
  if (error) throw error;
  return (data ?? []) as PcEtape[];
}
async function upd(id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("pc_etapes").update(patch).eq("id", id);
  if (error) throw error;
}
const allTrue = (c: Record<string, boolean>) => Object.fromEntries(Object.keys(c).map((k) => [k, true]));
const isoAt = (days: number, h: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString(); };

/** Deux dossiers fictifs parcourus de bout en bout, avec un refus et un recours (livrable §11). */
async function createDemo(userId: string, log: (m: string) => void) {
  const today = todayIso();

  // --- Certificateur : refus à l'étape 3, recommencée puis validée.
  const c = await db.from("pc_dossiers").insert({
    type: "certificateur", titre: `${DEMO_PREFIX} Titre RS — Formateur numérique`, organisme: "OF Démo", certificateur: "Certificateur Démo",
    code_rs: "RS0000", responsable_id: userId, created_by: userId, date_cible: addDaysIso(today, 60), notes: "Dossier fictif de démonstration.",
  }).select("id").single();
  if (c.error) throw c.error;
  let s = await demoEtapes(c.data.id);
  await upd(s[0].id, { statut: "valide", notes: "Appel du certificateur, RDV fixé. Interlocutrice : Mme Démo." });
  await upd(s[1].id, { event_at: isoAt(-5, 10), notes: "Visio : le dossier RS est complet." });
  await upd(s[1].id, { statut: "valide" });
  await upd(s[2].id, { statut: "en_attente", notes: "Dossier v1 envoyé par mail." });
  await upd(s[2].id, { statut: "refuse", motif_refus: "Dossier incomplet : référentiel manquant" });
  const r = await db.rpc("pc_recommencer_etape", { _etape: s[2].id, _echeance: addDaysIso(today, 15) });
  if (r.error) throw r.error;
  await upd(r.data as string, { statut: "valide", notes: "Dossier v2 avec référentiel : accepté." });
  s = await demoEtapes(c.data.id);
  await upd(s[3].id, { statut: "valide", notes: "Convention d'habilitation reçue." });
  log("Dossier Certificateur créé (refus puis nouvelle tentative validée).");

  // --- EDOF : pièces, étapes 0 à 4 validées, refus au webinaire puis recours.
  const e = await db.from("pc_dossiers").insert({
    type: "edof", titre: `${DEMO_PREFIX} Référencement EDOF — OF Démo`, organisme: "OF Démo", certificateur: "Certificateur Démo",
    responsable_id: userId, created_by: userId, parent_id: c.data.id, date_cible: addDaysIso(today, 45), notes: "Dossier fictif de démonstration.",
  }).select("id").single();
  if (e.error) throw e.error;
  const { data: types } = await db.from("pc_piece_types").select("id, code, libelle, validite_jours");
  const t = (code: string) => (types ?? []).find((x: any) => x.code === code);
  const pieces = [
    { code: "kbis", emission: addDaysIso(today, -20), validite: 90 },
    { code: "identite_representant", emission: addDaysIso(today, -400), validite: null },
    { code: "non_condamnation", emission: addDaysIso(today, -80), validite: 90 },
  ];
  const ins = await db.from("pc_documents").insert(pieces.map((p) => ({
    dossier_id: e.data.id, piece_type_id: t(p.code)?.id ?? null, nom: t(p.code)?.libelle ?? p.code, date_emission: p.emission, validite_jours: p.validite,
  })));
  if (ins.error) throw ins.error;
  s = await demoEtapes(e.data.id);
  for (const step of s.slice(0, 5)) {
    await upd(step.id, {
      statut: "valide",
      checklist: allTrue(step.checklist ?? {}),
      ...(step.lien_expiration ? { lien_expire_at: isoAt(10, 18) } : {}),
      notes: "Étape de démonstration réalisée.",
    });
  }
  const webinaire = s[5];
  await upd(webinaire.id, { event_at: isoAt(-1, 14), notes: "Webinaire CDC suivi." });
  await upd(webinaire.id, { statut: "refuse", motif_refus: "Offre non conforme" });
  await upd(webinaire.id, { statut: "recours", date_limite_recours: addDaysIso(today, 15), notes: "Recours envoyé avec l'offre corrigée." });
  log("Dossier EDOF créé (refus au webinaire, recours en cours).");
}

function DemoCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [logs, setLogs] = useState<string[]>([]);
  const log = (m: string) => setLogs((l) => [...l, m]);

  const create = useMutation({
    mutationFn: async () => { setLogs([]); await createDemo(user!.id, log); },
    onSuccess: () => { toast.success("Dossiers de démonstration créés"); qc.invalidateQueries({ queryKey: PC_ALL_KEY }); },
    onError: (e: any) => { toast.error(e?.message ?? "Erreur"); log(`Erreur : ${e?.message ?? e}`); },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.from("pc_dossiers").delete().like("titre", `${DEMO_PREFIX}%`).select("id");
      if (error) throw error;
      return (data ?? []).length as number;
    },
    onSuccess: (n) => { toast.success(`${n} dossier(s) de démonstration supprimé(s)`); qc.invalidateQueries({ queryKey: PC_ALL_KEY }); },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-gold" /><h2 className="font-semibold">Version de test</h2></div>
      <p className="text-sm text-muted-foreground">
        Crée deux dossiers fictifs préfixés « {DEMO_PREFIX} », parcourus de bout en bout : un Certificateur (refus à l'étape 3 puis nouvelle tentative validée)
        et un EDOF (pièces avec dates, refus au webinaire puis recours). Les dossiers existants ne sont pas touchés.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending || !user}>{create.isPending ? "Création…" : "Créer les 2 dossiers de démonstration"}</Button>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="outline" disabled={remove.isPending}>Supprimer les dossiers de démo</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer les dossiers de démonstration ?</AlertDialogTitle>
              <AlertDialogDescription>Seuls les dossiers dont le titre commence par « {DEMO_PREFIX} » sont supprimés, avec leur historique.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={() => remove.mutate()}>Supprimer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {logs.length > 0 && <ul className="text-sm list-disc pl-5 space-y-1">{logs.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </Card>
  );
}
