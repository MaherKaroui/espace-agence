import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LEGAL_LABELS } from "@/lib/legal-versions";
import { REQUIRED_DOCUMENTS, categorieLabel } from "@/lib/labels";
import { ShieldAlert, User as UserIcon, FileText, Loader2, ExternalLink, Eye, Download, ShieldCheck, FolderOpen, Lock } from "lucide-react";

function docTypeLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  for (const list of Object.values(REQUIRED_DOCUMENTS)) {
    const found = list.find((d) => d.key === key);
    if (found) return found.label;
  }
  return null;
}

export const Route = createFileRoute("/_authenticated/mes-donnees")({
  head: () => ({ meta: [{ title: "Mes données — IZISuivis" }] }),
  component: MesDonneesPage,
});


function MesDonneesPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [submittingDelete, setSubmittingDelete] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Consentements de l'utilisateur
  const { data: consents } = useQuery({
    queryKey: ["consents", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("consents")
        .select("*")
        .eq("user_id", user.id)
        .order("accepted_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Demande de suppression en cours
  const { data: pendingRequest } = useQuery({
    queryKey: ["deletion-request", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("deletion_requests")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  // Documents transmis par le client (via ses dossiers)
  const { data: myDocs = [] } = useQuery({
    queryKey: ["my-documents", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data: dossiers } = await supabase
        .from("dossiers")
        .select("id, titre, categorie")
        .eq("client_id", user.id);
      const dossierList = dossiers ?? [];
      if (dossierList.length === 0) return [];
      const dossierMap = new Map(dossierList.map((d) => [d.id, d]));
      const { data: docs, error } = await supabase
        .from("documents")
        .select("id, dossier_id, nom, storage_path, mime_type, taille, detected_type, statut, from_agence, created_at")
        .in("dossier_id", dossierList.map((d) => d.id))
        .eq("from_agence", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (docs ?? []).map((d) => ({ ...d, dossier: dossierMap.get(d.dossier_id) }));
    },
  });

  const [previewDoc, setPreviewDoc] = useState<{ doc: any; url: string } | null>(null);
  const openPreview = async (doc: any) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 600);
    if (error) { toast.error(error.message); return; }
    setPreviewDoc({ doc, url: data.signedUrl });
  };
  const downloadDoc = async (doc: any) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
    if (error) { toast.error(error.message); return; }
    await supabase.rpc("log_document_download", { _document_id: doc.id }).then(() => {}, () => {});
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const docsByDossier = useMemo(() => {
    const m = new Map<string, { dossier: any; items: any[] }>();
    for (const d of myDocs as any[]) {
      if (!d.dossier) continue;
      if (!m.has(d.dossier_id)) m.set(d.dossier_id, { dossier: d.dossier, items: [] });
      m.get(d.dossier_id)!.items.push(d);
    }
    return Array.from(m.values());
  }, [myDocs]);



  const handleSaveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        nom: String(fd.get("nom") || ""),
        prenom: String(fd.get("prenom") || ""),
        telephone: String(fd.get("telephone") || "") || null,
        entreprise: String(fd.get("societe") || "") || null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Vos informations ont été mises à jour.");
    qc.invalidateQueries({ queryKey: ["profile"] });
  };

  const handleRequestDeletion = async () => {
    if (!user) return;
    setSubmittingDelete(true);
    const { error } = await supabase.from("deletion_requests").insert({
      user_id: user.id,
      reason: deleteReason || null,
    });
    setSubmittingDelete(false);
    setConfirmOpen(false);
    setDeleteReason("");
    if (error) { toast.error(error.message); return; }
    toast.success("Demande enregistrée. L'agence la traitera sous 30 jours.");
    qc.invalidateQueries({ queryKey: ["deletion-request", user.id] });
  };

  return (
    <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="font-display text-3xl">Mes données</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Consultez, corrigez et exercez vos droits sur vos données personnelles.
          </p>
        </div>

        {/* Profil */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserIcon className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg">Mes informations</h2>
          </div>
          <form onSubmit={handleSaveProfile} className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="prenom">Prénom</Label>
              <Input id="prenom" name="prenom" defaultValue={profile?.prenom ?? ""} />
            </div>
            <div>
              <Label htmlFor="nom">Nom</Label>
              <Input id="nom" name="nom" defaultValue={profile?.nom ?? ""} />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" value={user?.email ?? ""} disabled />
              <p className="text-xs text-muted-foreground mt-1">Pour modifier l'e-mail, contactez l'agence.</p>
            </div>
            <div>
              <Label htmlFor="telephone">Téléphone</Label>
              <Input id="telephone" name="telephone" defaultValue={profile?.telephone ?? ""} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="societe">Société</Label>
              <Input id="societe" name="societe" defaultValue={profile?.entreprise ?? ""} />
              <a
                href={`https://www.pappers.fr/recherche?q=${encodeURIComponent(profile?.entreprise ?? "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1.5"
              >
                <ExternalLink className="h-3 w-3" />
                Rechercher ma société sur Pappers
              </a>
            </div>
            <div className="sm:col-span-2">
              <Button disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Enregistrer
              </Button>
            </div>
          </form>
        </Card>

        {/* Mes documents transmis */}
        <Card className="p-6">
          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h2 className="font-display text-lg">Mes documents transmis</h2>
            </div>
            <Badge variant="outline" className="gap-1 text-xs">
              <Lock className="h-3 w-3" /> Accès sécurisé
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-4 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            Vos fichiers sont chiffrés et accessibles uniquement par vous et l'équipe de votre agence. Chaque aperçu utilise un lien temporaire signé (10 min).
          </p>
          {docsByDossier.length === 0 ? (
            <p className="text-sm text-muted-foreground">Vous n'avez encore transmis aucun document.</p>
          ) : (
            <div className="space-y-4">
              {docsByDossier.map(({ dossier, items }) => (
                <div key={dossier.id} className="border rounded-md overflow-hidden">
                  <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderOpen className="h-4 w-4 text-gold shrink-0" />
                      <span className="text-xs uppercase tracking-wider text-gold font-medium">{categorieLabel(dossier.categorie)}</span>
                      <span className="text-sm font-medium truncate">{dossier.titre}</span>
                    </div>
                    <Link
                      to="/dossiers/$id"
                      params={{ id: dossier.id }}
                      className="text-xs text-primary hover:underline shrink-0"
                    >
                      Ouvrir le dossier →
                    </Link>
                  </div>
                  <ul className="divide-y">
                    {items.map((doc: any) => {
                      const demande = docTypeLabel(doc.detected_type);
                      return (
                        <li key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">
                              {doc.nom}
                              {demande && (
                                <span className="text-muted-foreground font-normal"> — {demande}</span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {new Date(doc.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                              {typeof doc.taille === "number" && ` · ${(doc.taille / 1024).toFixed(0)} Ko`}
                              {doc.statut === "accepte" && " · ✓ Validé"}
                              {doc.statut === "refuse" && " · ✗ Refusé"}
                              {doc.statut === "a_corriger" && " · À corriger"}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="sm" variant="ghost" onClick={() => openPreview(doc)} aria-label="Voir le document">
                              <Eye className="h-4 w-4 mr-1.5" /> Voir
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => downloadDoc(doc)} aria-label="Télécharger">
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Consentements */}

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg">Mes consentements</h2>
          </div>
          {consents && consents.length > 0 ? (
            <div className="space-y-2">
              {consents.map((c) => (
                <div key={c.id} className="flex items-center justify-between border rounded-md p-3 text-sm">
                  <div>
                    <div className="font-medium">{LEGAL_LABELS[c.document_type as keyof typeof LEGAL_LABELS] ?? c.document_type}</div>
                    <div className="text-xs text-muted-foreground">
                      Version {c.version} — {new Date(c.accepted_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
                    </div>
                  </div>
                  <Badge variant="secondary">Accepté</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun consentement enregistré.</p>
          )}
        </Card>

        {/* Suppression */}
        <Card className="p-6 border-destructive/40">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <h2 className="font-display text-lg">Suppression de mon compte</h2>
          </div>
          {pendingRequest ? (
            <div className="rounded-md bg-muted/50 p-4 text-sm">
              <p className="font-medium">Demande enregistrée</p>
              <p className="text-muted-foreground mt-1">
                Reçue le {new Date(pendingRequest.requested_at).toLocaleDateString("fr-FR")}. L'agence la traitera sous 30 jours maximum.
                Certaines données peuvent être conservées pour des obligations légales.
              </p>
            </div>
          ) : !confirmOpen ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Vous pouvez demander la suppression de votre compte à tout moment. L'agence traitera votre demande sous 30 jours maximum.
                Vos données personnelles seront anonymisées ; certaines informations peuvent être conservées pour des obligations légales
                (dossiers réglementaires, comptabilité).
              </p>
              <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
                Demander la suppression de mon compte
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="reason">Motif (facultatif)</Label>
                <Textarea
                  id="reason"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Vous pouvez indiquer un motif si vous le souhaitez…"
                  rows={3}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={handleRequestDeletion} disabled={submittingDelete}>
                  {submittingDelete && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Confirmer la demande
                </Button>
                <Button variant="outline" onClick={() => { setConfirmOpen(false); setDeleteReason(""); }}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Dialog open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
          <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden">
            <DialogHeader className="p-4 pb-2">
              <DialogTitle className="truncate pr-8">{previewDoc?.doc?.nom ?? "Aperçu"}</DialogTitle>
            </DialogHeader>
            <div className="bg-muted/30 h-[75vh] flex items-center justify-center overflow-auto">
              {previewDoc && (() => {
                const mime: string = previewDoc.doc.mime_type ?? "";
                const nom: string = previewDoc.doc.nom ?? "";
                if (mime.startsWith("image/")) {
                  return <img src={previewDoc.url} alt={nom} className="max-h-full max-w-full object-contain" />;
                }
                if (mime.startsWith("video/")) {
                  return <video src={previewDoc.url} controls className="max-h-full max-w-full" />;
                }
                if (mime.startsWith("audio/")) {
                  return <audio src={previewDoc.url} controls />;
                }
                if (mime === "application/pdf" || nom.toLowerCase().endsWith(".pdf")) {
                  return <iframe src={previewDoc.url} title={nom} className="w-full h-full bg-white" />;
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

