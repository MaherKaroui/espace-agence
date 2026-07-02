import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { categorieLabel, STATUTS } from "@/lib/labels";
import { ArrowLeft, Upload, Download, Trash2, FileText, Image as ImageIcon, Film, Loader2, LifeBuoy, MessageSquare } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { TasksPanel } from "@/components/tasks-panel";
import { VideoPlayer, isVideoMime } from "@/components/video-player";
import { RelanceButton } from "@/components/relance-button";
import { RequiredDocuments } from "@/components/required-documents";
import { NextActionCard } from "@/components/next-action-card";
import { DossierTimeline } from "@/components/dossier-timeline";
import { useServerFn } from "@tanstack/react-start";
import { classifyDocument } from "@/lib/classify-document.functions";

import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/dossiers/$id")({
  head: () => ({ meta: [{ title: "Dossier" }] }),
  component: DossierDetail,
});

function DossierDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const nav = useNavigate();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: dossier, isLoading } = useQuery({
    queryKey: ["dossier", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("dossiers").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["documents", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("documents").select("*").eq("dossier_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: taches = [] } = useQuery({
    queryKey: ["taches", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("taches").select("id,titre,statut,cote_client,verrouillee,updated_at").eq("dossier_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });


  const classify = useServerFn(classifyDocument);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const path = `${id}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
      if (upErr) throw upErr;
      const { data: inserted, error } = await supabase.from("documents").insert({
        dossier_id: id,
        uploader_id: user!.id,
        nom: file.name,
        storage_path: path,
        taille: file.size,
        mime_type: file.type,
        from_agence: isAdmin,
      }).select("id").single();
      if (error) throw error;
      // Classification IA en arrière-plan (n'échoue pas l'upload)
      if (inserted?.id) {
        classify({ data: { documentId: inserted.id } })
          .then(() => qc.invalidateQueries({ queryKey: ["documents", id] }))
          .catch((e) => console.warn("Classification échouée", e));
      }
    },
    onSuccess: () => {
      toast.success("Document ajouté — analyse en cours…");
      qc.invalidateQueries({ queryKey: ["documents", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (doc: any) => {
      await supabase.storage.from("documents").remove([doc.storage_path]);
      const { error } = await supabase.from("documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Supprimé"); qc.invalidateQueries({ queryKey: ["documents", id] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateDossier = useMutation({
    mutationFn: async (patch: any) => {
      const { error } = await supabase.from("dossiers").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mis à jour"); qc.invalidateQueries({ queryKey: ["dossier", id] }); qc.invalidateQueries({ queryKey: ["dossiers-mine"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteDossier = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("dossiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dossier supprimé");
      qc.invalidateQueries({ queryKey: ["admin-dossiers"] });
      qc.invalidateQueries({ queryKey: ["dossiers-mine"] });
      nav({ to: "/admin/dossiers" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => upload.mutate(f));
    e.target.value = "";
  };

  const downloadDoc = async (doc: any) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
    if (error) { toast.error(error.message); return; }
    await supabase.rpc("log_document_download", { _document_id: doc.id });
    window.open(data.signedUrl, "_blank");
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Chargement…</div>;
  if (!dossier) return <div className="p-8">Dossier introuvable.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => nav({ to: "/dossiers" })} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> {isAdmin ? "Retour aux dossiers" : "Retour à mes dossiers"}
        </button>
        {isAdmin && dossier.client_id && (
          <RelanceButton
            clientId={dossier.client_id}
            dossierId={dossier.id}
            dossierTitre={dossier.titre}
          />
        )}
      </div>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(dossier.categorie)}</span>
              <StatusBadge statut={dossier.statut} />
            </div>
            <h1 className="font-display text-2xl">{dossier.titre}</h1>
            {dossier.description && <p className="text-muted-foreground mt-2 whitespace-pre-line">{dossier.description}</p>}
          </div>
          <div className="w-full md:w-64">
            {isAdmin ? (
              <>
                <div className="text-xs text-muted-foreground mb-1">Avancement</div>
                <Progress value={dossier.avancement} />
                <div className="text-sm mt-1">{dossier.avancement}%</div>
              </>
            ) : (
              <ClientProgressSummary
                avancement={dossier.avancement}
                taches={taches as any}
              />
            )}
          </div>

        </div>

        {isAdmin && (
          <div className="mt-6 grid md:grid-cols-3 gap-3 pt-6 border-t">
            <div>
              <label className="text-xs text-muted-foreground">Statut</label>
              <Select defaultValue={dossier.statut} onValueChange={(v) => updateDossier.mutate({ statut: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Avancement (%)</label>
              <Input type="number" min={0} max={100} defaultValue={dossier.avancement}
                onBlur={(e) => {
                  const v = Math.max(0, Math.min(100, Number(e.target.value)));
                  if (v !== dossier.avancement) updateDossier.mutate({ avancement: v });
                }} />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs text-muted-foreground">Commentaire de l'agence</label>
              <Textarea defaultValue={dossier.commentaire_agence ?? ""}
                onBlur={(e) => updateDossier.mutate({ commentaire_agence: e.target.value })} rows={2} />
            </div>
          </div>
        )}

        {!isAdmin && dossier.commentaire_agence && (
          <div className="mt-6 pt-6 border-t">
            <div className="text-xs text-muted-foreground mb-1">Commentaire de l'agence</div>
            <p className="text-sm">{dossier.commentaire_agence}</p>
          </div>
        )}

        <div className="mt-6 pt-6 border-t">
          <label className="text-xs text-muted-foreground">
            {isAdmin ? "Site web" : "Votre site web"}
          </label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              type="url"
              placeholder="https://exemple.com"
              defaultValue={(dossier as any).site_web ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== ((dossier as any).site_web ?? null)) updateDossier.mutate({ site_web: v });
              }}
            />
            {(dossier as any).site_web && (
              <a
                href={(dossier as any).site_web}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline whitespace-nowrap"
              >
                {isAdmin ? "Ouvrir ↗" : "Voir mon site ↗"}
              </a>
            )}
          </div>
          {!isAdmin && (
            <p className="text-xs text-muted-foreground mt-1">Renseignez l'adresse de votre site (facultatif).</p>
          )}

        </div>

      </Card>



      {!isAdmin && (
        <NextActionCard
          categorie={dossier.categorie}
          documents={documents as any}
          taches={taches as any}
          dossierStatut={dossier.statut}
        />
      )}

      {/* Côté admin : panneau des tâches en haut ; côté client : plus bas, moins prioritaire */}
      {isAdmin && <TasksPanel dossierId={id} />}

      <RequiredDocuments dossierId={id} categorie={dossier.categorie} documents={documents as any} />

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="font-display text-xl">
              {isAdmin ? `Documents (${documents.length})` : "Documents déjà envoyés"}
            </h2>
            {!isAdmin && (
              <p className="text-sm text-muted-foreground mt-1">
                {documents.length === 0
                  ? "Aucun document envoyé pour l'instant."
                  : `Vous avez envoyé ${documents.length} document${documents.length > 1 ? "s" : ""}.`}
              </p>
            )}
          </div>
          <div>
            <input ref={fileInput} type="file" multiple hidden onChange={handleUpload} />
            <Button variant={isAdmin ? "default" : "outline"} onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {upload.isPending ? "Envoi en cours…" : isAdmin ? "Autres documents" : "Ajouter un autre document"}
            </Button>
          </div>
        </div>

        {documents.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">Aucun document pour l'instant.</p>
            <p className="text-xs text-muted-foreground/80 mt-1">
              {isAdmin
                ? "Cliquez sur « Autres documents » pour commencer."
                : "Utilisez la liste plus haut pour envoyer les documents demandés."}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {documents.map((d) => {
              const isImg = d.mime_type?.startsWith("image/");
              const isVid = isVideoMime(d.mime_type);
              return (
                <div key={d.id} className="py-3 flex items-center gap-3">
                  {isVid ? (
                    <VideoPlayer
                      documentId={d.id}
                      storagePath={d.storage_path}
                      fileName={d.nom}
                      thumbnailPath={d.thumbnail_path}
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                      {isImg ? <ImageIcon className="h-5 w-5 text-muted-foreground" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1">
                      {isVid && <Film className="h-3.5 w-3.5 text-muted-foreground" />}
                      {d.nom}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.from_agence ? "Envoyé par l'agence" : "Déposé par le client"} · {formatDistanceToNow(new Date(d.created_at), { addSuffix: true, locale: fr })}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => downloadDoc(d)} aria-label="Télécharger"><Download className="h-4 w-4" /></Button>
                  {(isAdmin || d.uploader_id === user?.id) && (
                    isAdmin ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Supprimer"
                        disabled={del.isPending && (del.variables as any)?.id === d.id}
                        onClick={() => del.mutate(d)}
                      >
                        {del.isPending && (del.variables as any)?.id === d.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Retirer ce fichier"
                            disabled={del.isPending && (del.variables as any)?.id === d.id}
                          >
                            {del.isPending && (del.variables as any)?.id === d.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Retirer ce fichier&nbsp;?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Êtes-vous sûr&nbsp;? Vous pourrez en ajouter un autre après.
                              <br />
                              <span className="block mt-2 text-xs text-muted-foreground">Fichier : {d.nom}</span>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del.mutate(d)}>
                              Oui, retirer
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )
                  )}

                </div>
              );
            })}
          </div>
        )}
      </Card>

      {!isAdmin && (
        <Card className="p-6 border-primary/20 bg-primary/5">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <LifeBuoy className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-lg">Besoin d'aide&nbsp;?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Si vous êtes bloqué ou si vous avez une question, envoyez-nous un message.
                L'agence vous répond dans les meilleurs délais.
              </p>
            </div>
            <Button
              onClick={() => {
                try {
                  sessionStorage.setItem(
                    "chat-prefill",
                    `Bonjour, j'ai besoin d'aide sur mon dossier « ${dossier.titre} ».`,
                  );
                } catch {}
                nav({ to: "/messages" });
              }}
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Demander de l'aide
            </Button>
          </div>
        </Card>
      )}

      {!isAdmin && <TasksPanel dossierId={id} />}

      <DossierTimeline
        dossier={dossier as any}
        documents={documents as any}
        taches={taches as any}
      />
    </div>
  );
}

function ClientProgressSummary({
  avancement,
  taches,
}: {
  avancement: number;
  taches: Array<{ statut: string }>;
}) {
  const total = taches.length;
  const done = taches.filter((t) => t.statut === "termine").length;

  let phrase: string;
  if (total === 0) {
    if (avancement >= 100) phrase = "Votre dossier est terminé.";
    else if (avancement >= 66) phrase = "Votre dossier avance très bien.";
    else if (avancement >= 33) phrase = "Votre dossier avance bien.";
    else if (avancement > 0) phrase = "Votre dossier est commencé.";
    else phrase = "Votre dossier va démarrer.";
  } else if (done === total) {
    phrase = "Toutes les étapes sont terminées.";
  } else if (done === 0) {
    phrase = `Votre dossier est commencé. ${total} étape${total > 1 ? "s" : ""} à venir.`;
  } else {
    phrase = `Votre dossier avance bien : ${done} étape${done > 1 ? "s" : ""} terminée${done > 1 ? "s" : ""} sur ${total}.`;
  }

  return (
    <>
      <div className="text-xs text-muted-foreground mb-1">Avancement</div>
      <Progress value={avancement} />
      <p className="text-sm mt-2 leading-snug">{phrase}</p>
    </>
  );
}

const QUALIOPI_AUDIT_TYPES = [
  { value: "nouvel_entrant", label: "Nouvel entrant" },
  { value: "audit_surveillance", label: "Audit de surveillance" },
  { value: "renouvellement", label: "Renouvellement" },
  { value: "complementaire", label: "Audit complémentaire" },
];
const QUALIOPI_SCOPES = [
  { value: "AF", label: "Actions de Formation (AF)" },
  { value: "BC", label: "Bilans de Compétences (BC)" },
  { value: "VAE", label: "Validation des Acquis (VAE)" },
  { value: "CFA", label: "Apprentissage / CFA" },
];

function QualiopiBlock({
  dossier,
  onUpdate,
}: {
  dossier: any;
  onUpdate: (patch: any) => void;
}) {
  const auditType: string | null = dossier.qualiopi_audit_type ?? null;
  const scopes: string[] = Array.isArray(dossier.qualiopi_scopes) ? dossier.qualiopi_scopes : [];

  const toggleScope = (v: string) => {
    const next = scopes.includes(v) ? scopes.filter((x) => x !== v) : [...scopes, v];
    onUpdate({ qualiopi_scopes: next });
  };

  const parseNum = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  return (
    <Card className="p-6 space-y-5">
      <div>
        <h2 className="font-display text-xl">Détails Qualiopi</h2>
        <p className="text-sm text-muted-foreground mt-1">Type d'audit, périmètre et informations sur vos stagiaires.</p>
      </div>

      <div>
        <div className="text-sm font-medium mb-2">Type d'audit</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {QUALIOPI_AUDIT_TYPES.map((a) => {
            const active = auditType === a.value;
            return (
              <button
                key={a.value}
                type="button"
                onClick={() => onUpdate({ qualiopi_audit_type: a.value })}
                className={`text-left rounded-lg border p-3 hover:border-primary/60 transition-colors ${
                  active ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                      active ? "border-primary" : "border-muted-foreground/40"
                    }`}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="text-sm font-medium">{a.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-sm font-medium mb-2">Périmètre concerné (cochez tout ce qui s'applique)</div>
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
                <div className="flex items-center gap-2">
                  <span
                    className={`h-4 w-4 rounded border flex items-center justify-center text-primary-foreground ${
                      active ? "bg-primary border-primary" : "border-muted-foreground/40"
                    }`}
                  >
                    {active && <span className="text-[10px] leading-none">✓</span>}
                  </span>
                  <span className="text-sm font-medium">{s.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={!!dossier.has_stagiaires}
            onChange={(e) => {
              const checked = e.target.checked;
              const patch: any = { has_stagiaires: checked };
              if (checked && (!Array.isArray(dossier.stagiaires) || dossier.stagiaires.length === 0)) {
                patch.stagiaires = [{ nom: "", prenom: "", email: "", telephone: "", formation: "", date_debut: "", date_fin: "" }];
              }
              onUpdate(patch);
            }}
          />
          <span className="text-sm font-medium">Avez-vous des stagiaires à déclarer&nbsp;?</span>
        </label>
      </div>

      {dossier.has_stagiaires && (
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium mb-2">Volumétrie</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs text-muted-foreground">Stagiaires / an</label>
                <Input
                  type="number"
                  min={0}
                  defaultValue={dossier.nb_stagiaires ?? ""}
                  onBlur={(e) => {
                    const v = parseNum(e.target.value);
                    if (v !== (dossier.nb_stagiaires ?? null)) onUpdate({ nb_stagiaires: v });
                  }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Formateurs</label>
                <Input
                  type="number"
                  min={0}
                  defaultValue={dossier.nb_formateurs ?? ""}
                  onBlur={(e) => {
                    const v = parseNum(e.target.value);
                    if (v !== (dossier.nb_formateurs ?? null)) onUpdate({ nb_formateurs: v });
                  }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Formations proposées</label>
                <Input
                  type="number"
                  min={0}
                  defaultValue={dossier.nb_formations ?? ""}
                  onBlur={(e) => {
                    const v = parseNum(e.target.value);
                    if (v !== (dossier.nb_formations ?? null)) onUpdate({ nb_formations: v });
                  }}
                />
              </div>
            </div>
          </div>

          <StagiairesList
            list={Array.isArray(dossier.stagiaires) ? dossier.stagiaires : []}
            onChange={(next) => onUpdate({ stagiaires: next })}
          />
        </div>
      )}

    </Card>
  );
}

type Stagiaire = {
  nom?: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  formation?: string;
  date_debut?: string;
  date_fin?: string;
};

function StagiairesList({
  list,
  onChange,
}: {
  list: Stagiaire[];
  onChange: (next: Stagiaire[]) => void;
}) {
  const update = (i: number, patch: Partial<Stagiaire>) => {
    const next = list.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(next);
  };
  const add = () =>
    onChange([
      ...list,
      { nom: "", prenom: "", email: "", telephone: "", formation: "", date_debut: "", date_fin: "" },
    ]);
  const remove = (i: number) => onChange(list.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">Informations des stagiaires</div>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          + Ajouter un stagiaire
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun stagiaire renseigné.</p>
      ) : (
        <div className="space-y-3">
          {list.map((s, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Stagiaire #{i + 1}</div>
                <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)}>
                  Supprimer
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-muted-foreground">Nom</label>
                  <Input
                    defaultValue={s.nom ?? ""}
                    onBlur={(e) => update(i, { nom: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Prénom</label>
                  <Input
                    defaultValue={s.prenom ?? ""}
                    onBlur={(e) => update(i, { prenom: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Email</label>
                  <Input
                    type="email"
                    defaultValue={s.email ?? ""}
                    onBlur={(e) => update(i, { email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Téléphone</label>
                  <Input
                    defaultValue={s.telephone ?? ""}
                    onBlur={(e) => update(i, { telephone: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-muted-foreground">Formation suivie</label>
                  <Input
                    defaultValue={s.formation ?? ""}
                    onBlur={(e) => update(i, { formation: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Date de début</label>
                  <Input
                    type="date"
                    defaultValue={s.date_debut ?? ""}
                    onBlur={(e) => update(i, { date_debut: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Date de fin</label>
                  <Input
                    type="date"
                    defaultValue={s.date_fin ?? ""}
                    onBlur={(e) => update(i, { date_fin: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

