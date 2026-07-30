import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { useScrollToHash } from "@/hooks/use-scroll-to-hash";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { categorieLabel, STATUTS } from "@/lib/labels";
import { buildDossierTitre } from "@/lib/dossier-title";
import { ArrowLeft, Upload, Download, Trash2, FileText, Image as ImageIcon, Film, Loader2, LifeBuoy, MessageSquare, Eye, Link2, Send } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { TasksPanel } from "@/components/tasks-panel";
import { VideoPlayer, isVideoMime } from "@/components/video-player";
import { DossierSuiviRappels } from "@/components/dossier-suivi-rappels";
import { DossierLinkedTask } from "@/components/dossier-linked-task";
import { DossierExternalIntervenants } from "@/components/dossier-external-intervenants";
import { DossierExternalChat } from "@/components/dossier-external-chat";
import { QualiopiRequestsPanel } from "@/components/qualiopi-requests-panel";

import { RequiredDocuments } from "@/components/required-documents";
import { NextActionCard } from "@/components/next-action-card";
import { DossierTimeline } from "@/components/dossier-timeline";
import { computeAvancement } from "@/lib/next-action";

import { useServerFn } from "@tanstack/react-start";
import { classifyDocument } from "@/lib/classify-document.functions";
import { inviteClient } from "@/lib/admin-clients.functions";

import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { notifyEmail, STATUT_LABELS } from "@/lib/email/notify";

export const Route = createFileRoute("/_authenticated/dossiers/$id")({
  head: () => ({ meta: [{ title: "Dossier" }] }),
  component: DossierDetail,
});

function DossierDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  useScrollToHash([id]);

  // Any agency staff (admin / direction / manager / consultant) sees the
  // management UI. RLS restricts non-admins to dossiers in their poles.
  const { isStaff: isAdmin } = useRole();
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

  const { data: clientProfile } = useQuery({
    queryKey: ["dossier-client", (dossier as any)?.client_id],
    enabled: !!(dossier as any)?.client_id,
    queryFn: async () => {
      const { data } = await supabase.from("profiles")
        .select("email, prenom, nom").eq("id", (dossier as any).client_id).maybeSingle();
      return data;
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
      const oldStatut = dossier?.statut as string | undefined;
      const { error } = await supabase.from("dossiers").update(patch).eq("id", id);
      if (error) throw error;
      // Send client email when statut changes (deduped via idempotency key: dossier + new statut)
      if (isAdmin && patch.statut && patch.statut !== oldStatut && dossier) {
        const info = STATUT_LABELS[patch.statut as string] ?? { label: patch.statut, explication: "" };
        const { data: prof } = await supabase
          .from("profiles").select("prenom, nom, email").eq("id", dossier.client_id).maybeSingle();
        if (prof?.email) {
          const templateName = patch.statut === "termine"
            ? "client-dossier-termine"
            : patch.statut === "a_completer" || patch.statut === "documents_manquants"
              ? "client-dossier-attente"
              : "client-dossier-statut";
          notifyEmail({
            templateName,
            recipientEmail: prof.email,
            idempotencyKey: `dossier-${id}-statut-${patch.statut}`,
            templateData: {
              prenom: prof.prenom || "",
              dossierTitre: dossier.titre,
              statutLabel: info.label,
              explication: info.explication,
              message: info.explication,
              dossierId: id,
            },
          });
        }
      }
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

  const [previewDoc, setPreviewDoc] = useState<{ doc: any; url: string } | null>(null);
  const openPreview = async (doc: any) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 600);
    if (error) { toast.error(error.message); return; }
    setPreviewDoc({ doc, url: data.signedUrl });
  };


  if (isLoading) return <div className="p-8 text-muted-foreground">Chargement…</div>;
  if (!dossier) return (
    <div className="p-8 max-w-md mx-auto text-center space-y-3">
      <div className="font-display text-xl">Accès refusé</div>
      <p className="text-sm text-muted-foreground">Ce dossier n'existe pas ou ne fait pas partie de vos pôles.</p>
      <Button variant="outline" onClick={() => nav({ to: "/dashboard" })}>Retour à l'accueil</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button onClick={() => nav({ to: isAdmin ? "/admin/dossiers" : "/dossiers" })} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 min-h-11 py-1">
          <ArrowLeft className="h-4 w-4" /> {isAdmin ? "Retour aux dossiers" : "Retour à mes dossiers"}
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const url = `${window.location.origin}/dossiers/${id}`;
                try {
                  await navigator.clipboard.writeText(url);
                  toast.success("Lien copié");
                } catch { toast.error("Impossible de copier"); }
              }}
            >
              <Link2 className="h-4 w-4 mr-1.5" /> Copier le lien
            </Button>
          )}
          {isAdmin && dossier.client_id && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const { data: prof } = await supabase
                  .from("profiles").select("prenom, email").eq("id", dossier.client_id).maybeSingle();
                if (!prof?.email) return toast.error("Email client introuvable");
                const info = STATUT_LABELS[dossier.statut as string] ?? { label: dossier.statut, explication: "" };
                const ok = await notifyEmail({
                  templateName: "client-dossier-statut",
                  recipientEmail: prof.email,
                  idempotencyKey: `manual-resend-${id}-${Date.now()}`,
                  templateData: {
                    prenom: prof.prenom || "",
                    dossierTitre: dossier.titre,
                    statutLabel: info.label,
                    explication: info.explication,
                    dossierId: id,
                  },
                });
                toast[ok ? "success" : "error"](ok ? "Email renvoyé au client" : "Envoi impossible (template désactivé ?)");
              }}
            >
              <Send className="h-4 w-4 mr-1.5" /> Relance client
            </Button>
          )}
          {isAdmin && !dossier.client_id && (
            <InviteClientToDossier dossierId={dossier.id} onDone={() => qc.invalidateQueries({ queryKey: ["dossier", id] })} />
          )}
        </div>
      </div>

      {/* Bloc "À faire maintenant" — priorité #1 côté client */}
      {!isAdmin && (
        <NextActionCard
          categorie={dossier.categorie}
          documents={documents as any}
          taches={taches as any}
          dossierStatut={dossier.statut}
        />
      )}


      {isAdmin && <DossierLinkedTask dossierId={dossier.id} />}
      {isAdmin && <DossierExternalIntervenants dossierId={dossier.id} />}
      {isAdmin && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div id="audit-chat" className="scroll-mt-20"><DossierExternalChat dossierId={dossier.id} /></div>
          <div id="qualiopi" className="scroll-mt-20"><QualiopiRequestsPanel dossierId={dossier.id} /></div>
        </div>
      )}




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
            {(() => {
              // Source unique de vérité : même calcul que la liste & le dashboard.
              const av = computeAvancement(dossier.categorie, documents as any, taches as any, dossier.statut);
              return isAdmin ? (
                <>
                  <div className="text-xs text-muted-foreground mb-1">Avancement</div>
                  <Progress value={av} />
                  <div className="text-sm mt-1">{av}%</div>
                  {dossier.avancement !== av && (
                    <div className="text-[11px] text-warning mt-1">
                      Saisi manuellement : {dossier.avancement}%
                    </div>
                  )}
                </>
              ) : (
                <ClientProgressSummary
                  avancement={av}
                  taches={taches as any}
                />
              );
            })()}
          </div>


        </div>

        {isAdmin && (
          <div className="mt-6 grid md:grid-cols-3 gap-3 pt-6 border-t">
            <div className="md:col-span-3">
              <label className="text-xs text-muted-foreground">Titre du dossier</label>
              <Input defaultValue={dossier.titre}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== dossier.titre) updateDossier.mutate({ titre: v });
                }} />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs text-muted-foreground">Description</label>
              <Textarea defaultValue={dossier.description ?? ""}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (dossier.description ?? "")) updateDossier.mutate({ description: v });
                }} rows={3} />
            </div>
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
            <div className="flex items-end">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full" disabled={deleteDossier.isPending}>
                    {deleteDossier.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                    Supprimer le dossier
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer ce dossier&nbsp;?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Action <strong>irréversible</strong>. Documents, tâches et historique seront supprimés.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteDossier.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Supprimer définitivement
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground">Nom de l'organisme de formation</label>
            <Input
              type="text"
              placeholder="Ex : Mon organisme de formation"
              defaultValue={(dossier as any).organisme_nom ?? ""}
              maxLength={120}
              onBlur={(e) => {
                const v = e.target.value.trim();
                const cur = ((dossier as any).organisme_nom ?? "").trim();
                if (v === cur) return;
                const patch: any = { organisme_nom: v || null };
                // Regénère le titre s'il correspond encore au format automatique
                const currentAuto = buildDossierTitre(dossier.categorie, cur);
                if (!cur || dossier.titre === currentAuto) {
                  patch.titre = buildDossierTitre(dossier.categorie, v);
                }
                updateDossier.mutate(patch);
              }}
            />
            {!((dossier as any).organisme_nom ?? "").trim() && (
              <p className="text-xs text-warning mt-1 flex items-center gap-1">
                ⚠️ Nom de l'OF manquant — merci de le renseigner pour identifier ce dossier.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground">E-mail de l'OF</label>
            <Input
              type="email"
              placeholder="contact@monorganisme.fr"
              defaultValue={(dossier as any).organisme_email ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== ((dossier as any).organisme_email ?? null)) updateDossier.mutate({ organisme_email: v } as any);
              }}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Téléphone de l'OF</label>
            <Input
              type="tel"
              placeholder="06 12 34 56 78"
              defaultValue={(dossier as any).organisme_telephone ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== ((dossier as any).organisme_telephone ?? null)) updateDossier.mutate({ organisme_telephone: v } as any);
              }}
            />
          </div>
        </div>

      </Card>




      {/* Côté admin : panneau des tâches en haut ; côté client : plus bas, moins prioritaire */}
      {isAdmin && <TasksPanel dossierId={id} />}

      <RequiredDocuments dossierId={id} categorie={dossier.categorie} documents={documents as any} />

      {dossier.categorie === "qualiopi" && (
        <QualiopiBlock
          dossier={dossier}
          onUpdate={(patch) => updateDossier.mutate(patch)}
        />
      )}

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
        <p className="text-xs text-muted-foreground -mt-2 mb-2">
          Vos documents sont stockés de manière sécurisée et traités conformément à notre{" "}
          <a href="/politique-confidentialite" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            Politique de confidentialité
          </a>.
        </p>

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
            {documents.filter((d) => !!d.storage_path).map((d) => {
              const isImg = d.mime_type?.startsWith("image/");
              const isVid = isVideoMime(d.mime_type);
              return (
                <div key={d.id} className="py-3 flex items-center gap-3">
                  {isVid ? (
                    <VideoPlayer
                      documentId={d.id}
                      storagePath={d.storage_path ?? ""}
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
                  <Button size="sm" variant="ghost" onClick={() => openPreview(d)} aria-label="Voir"><Eye className="h-4 w-4 mr-1.5" /> Voir</Button>
                  <Button size="sm" variant="ghost" onClick={() => downloadDoc(d)} aria-label="Télécharger"><Download className="h-4 w-4 mr-1.5" /> Télécharger</Button>
                  {(isAdmin || d.uploader_id === user?.id) && (
                    isAdmin ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Retirer"
                        disabled={del.isPending && (del.variables as any)?.id === d.id}
                        onClick={() => del.mutate(d)}
                      >
                        {del.isPending && (del.variables as any)?.id === d.id ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin text-destructive" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-1.5 text-destructive" />
                        )}
                        <span className="text-destructive">Retirer</span>
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
                              <Loader2 className="h-4 w-4 mr-1.5 animate-spin text-destructive" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-1.5 text-destructive" />
                            )}
                            <span className="text-destructive">Retirer</span>
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

      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="truncate pr-8">{previewDoc?.doc?.nom ?? "Aperçu"}</DialogTitle>
          </DialogHeader>
          <div className="bg-muted/30 h-[75vh] flex items-center justify-center overflow-auto">
            {previewDoc && (() => {
              const mime: string = previewDoc.doc.mime_type ?? "";
              if (mime.startsWith("image/")) {
                return <img src={previewDoc.url} alt={previewDoc.doc.nom} className="max-h-full max-w-full object-contain" />;
              }
              if (isVideoMime(mime)) {
                return <video src={previewDoc.url} controls className="max-h-full max-w-full" />;
              }
              if (mime.startsWith("audio/")) {
                return <audio src={previewDoc.url} controls />;
              }
              if (mime === "application/pdf" || previewDoc.doc.nom?.toLowerCase().endsWith(".pdf")) {
                return <iframe src={previewDoc.url} title={previewDoc.doc.nom} className="w-full h-full bg-white" />;
              }
              return (
                <div className="text-center p-6 space-y-3">
                  <FileText className="h-10 w-10 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Aperçu non disponible pour ce type de fichier.</p>
                  <Button onClick={() => downloadDoc(previewDoc.doc)}>
                    <Download className="h-4 w-4 mr-2" /> Télécharger pour ouvrir
                  </Button>
                </div>
              );
            })()}
          </div>
          {previewDoc && (
            <div className="flex justify-end gap-2 p-3 border-t">
              <Button variant="outline" onClick={() => downloadDoc(previewDoc.doc)}>
                <Download className="h-4 w-4 mr-2" /> Télécharger
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
        <h2 className="font-display text-xl">Informations pour votre dossier Qualiopi</h2>
        <p className="text-sm text-muted-foreground mt-1">Type d'audit, vos activités concernées et informations sur vos stagiaires.</p>
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
        <div className="text-sm font-medium mb-2">Vos activités concernées (cochez tout ce qui s'applique)</div>
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
            <div className="text-sm font-medium mb-2">Quelques chiffres sur votre activité</div>
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


function InviteClientToDossier({ dossierId, onDone }: { dossierId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const invite = useServerFn(inviteClient);
  const m = useMutation({
    mutationFn: async () => invite({ data: { email, prenom: prenom || undefined, nom: nom || undefined, dossier_id: dossierId } }),
    onSuccess: (res: any) => {
      toast.success(res?.invited ? "Invitation envoyée" : "Client existant rattaché au dossier");
      setOpen(false); setEmail(""); setPrenom(""); setNom("");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur"),
  });
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">Inviter le client</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Inviter le client sur ce dossier</AlertDialogTitle>
          <AlertDialogDescription>
            Un e-mail d'invitation sera envoyé. Si l'adresse existe déjà, le compte sera réutilisé et rattaché au dossier.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Prénom</label>
              <Input value={prenom} onChange={(e) => setPrenom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Nom</label>
              <Input value={nom} onChange={(e) => setNom(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">E-mail</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@exemple.fr" />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); m.mutate(); }} disabled={!email || m.isPending}>
            {m.isPending ? "Envoi…" : "Envoyer l'invitation"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
