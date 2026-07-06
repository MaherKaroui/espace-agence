import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LEGAL_LABELS } from "@/lib/legal-versions";
import { ShieldAlert, User as UserIcon, FileText, Loader2, ExternalLink } from "lucide-react";

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
      </div>
  );
}
