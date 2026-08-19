import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CATEGORIES, JURIDIQUE_TYPES, categorieLabel } from "@/lib/labels";
import { buildDossierTitre } from "@/lib/dossier-title";
import { sendTransactionalEmail } from "@/lib/email/send";
import { notifyTeamNewDossier } from "@/lib/email/notify-team";
import { Plus } from "lucide-react";

type Props = {
  /** Label du bouton déclencheur. */
  triggerLabel?: string;
  /** Comportement après création : par défaut navigue vers la fiche dossier. */
  onCreated?: (dossierId: string) => void;
  /** Désactive la navigation auto (utile côté admin pour rester sur la liste). */
  stayInPlace?: boolean;
  className?: string;
};

/**
 * Dialogue de création de dossier partagé entre l'espace client (/dossiers)
 * et l'espace admin (/admin/dossiers). Toute l'équipe agence peut créer.
 */
export function CreateDossierDialog({
  triggerLabel = "Nouveau dossier",
  onCreated,
  stayInPlace = false,
  className,
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [adminCategorie, setAdminCategorie] = useState<string>("");
  const [adminJuridiqueType, setAdminJuridiqueType] = useState<string>("");

  const { data: poles = [] } = useQuery({
    queryKey: ["poles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("poles")
        .select("id, code, nom")
        .eq("actif", true)
        .order("nom");
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
      organisme_nom: string;
      site_web?: string | null;
      organisme_email?: string | null;
      organisme_telephone?: string | null;
      juridique_type?: string | null;
    }) => {
      const row: any = {
        client_id: user!.id,
        titre: payload.titre,
        categorie: payload.categorie as any,
        pole_id: payload.pole_id,
        description: payload.description || null,
        organisme_nom: payload.organisme_nom,
        site_web: payload.site_web?.trim() || null,
        organisme_email: payload.organisme_email?.trim() || null,
        organisme_telephone: payload.organisme_telephone?.trim() || null,
      };
      if (payload.categorie === "juridique") {
        row.juridique_type = payload.juridique_type ?? null;
      }
      const { data, error } = await supabase.from("dossiers").insert(row).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data, payload) => {
      toast.success("Dossier créé.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["dossiers-mine"] });
      qc.invalidateQueries({ queryKey: ["admin-dossiers"] });
      const clientName =
        `${user?.user_metadata?.prenom ?? ""} ${user?.user_metadata?.nom ?? ""}`.trim() ||
        user?.email ||
        "Agence";
      sendTransactionalEmail({
        templateName: "admin-new-dossier",
        idempotencyKey: `admin-new-dossier-${data?.id}`,
        templateData: {
          clientName,
          clientEmail: user?.email,
          dossierTitre: buildDossierTitre((payload as any)?.categorie, (payload as any)?.organisme_nom),
          categorie: categorieLabel((payload as any)?.categorie),
          dossierId: data?.id,
          appUrl: "https://izisuivis.com",
        },
      });
      if (data?.id) {
        try {
          notifyTeamNewDossier(data.id);
        } catch {
          /* silencieux */
        }
      }
      if (user?.email) {
        sendTransactionalEmail({
          templateName: "client-dossier-cree",
          recipientEmail: user.email,
          idempotencyKey: `client-dossier-cree-${data?.id}`,
          templateData: {
            prenom: user?.user_metadata?.prenom || "",
            dossierTitre: buildDossierTitre((payload as any)?.categorie, (payload as any)?.organisme_nom),
            categorie: categorieLabel((payload as any)?.categorie),
            dossierId: data?.id,
            appUrl: "https://izisuivis.com",
          },
        });
      }
      if (onCreated) {
        onCreated(data.id);
      } else if (!stayInPlace && data?.id) {
        navigate({ to: "/dossiers/$id", params: { id: data.id } });
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const submitAdmin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const organisme_nom = ((fd.get("organisme_nom") as string) ?? "").trim();
    const categorie = fd.get("categorie") as string;
    const pole_id = fd.get("pole_id") as string;
    const description = (fd.get("description") as string)?.trim() ?? "";
    const organisme_email = ((fd.get("organisme_email") as string) ?? "").trim() || undefined;
    const organisme_telephone = ((fd.get("organisme_telephone") as string) ?? "").trim() || undefined;
    const site_web = ((fd.get("site_web") as string) ?? "").trim() || undefined;
    const juridique_type = ((fd.get("juridique_type") as string) ?? "").trim() || null;
    if (!organisme_nom) {
      toast.error("Nom de l'organisme de formation requis");
      return;
    }
    if (!categorie || !pole_id) {
      toast.error("Champs requis");
      return;
    }
    if (categorie === "juridique" && !juridique_type) {
      toast.error("Choisissez le type juridique");
      return;
    }
    if (!organisme_email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(organisme_email)) {
      toast.error("E-mail de l'OF requis et valide");
      return;
    }
    if (!organisme_telephone || organisme_telephone.replace(/\D/g, "").length < 8) {
      toast.error("Téléphone de l'OF requis (8 chiffres minimum)");
      return;
    }
    const titre = buildDossierTitre(categorie, organisme_nom, juridique_type);
    create.mutate({
      titre,
      categorie,
      pole_id,
      description,
      organisme_nom,
      organisme_email,
      organisme_telephone,
      site_web,
      juridique_type,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={className}>
          <Plus className="h-4 w-4 mr-2" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau dossier</DialogTitle>
        </DialogHeader>
        <form onSubmit={submitAdmin} className="space-y-4">
          <div>
            <Label htmlFor="organisme_nom">
              Nom de l'organisme de formation <span className="text-destructive">*</span>
            </Label>
            <Input
              id="organisme_nom"
              name="organisme_nom"
              required
              maxLength={120}
              placeholder="Ex : Mon organisme de formation"
            />
            <p className="text-xs text-muted-foreground mt-1">Le titre du dossier sera généré automatiquement.</p>
          </div>
          <div>
            <Label>Pôle</Label>
            <Select name="pole_id" required>
              <SelectTrigger>
                <SelectValue placeholder="Choisir un pôle…" />
              </SelectTrigger>
              <SelectContent>
                {poles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Catégorie</Label>
            <Select
              name="categorie"
              required
              value={adminCategorie}
              onValueChange={(v) => {
                setAdminCategorie(v);
                if (v !== "juridique") setAdminJuridiqueType("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choisir…" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {adminCategorie === "juridique" && (
            <div>
              <Label>
                Type juridique <span className="text-destructive">*</span>
              </Label>
              <Select
                name="juridique_type"
                required
                value={adminJuridiqueType}
                onValueChange={setAdminJuridiqueType}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir le type…" />
                </SelectTrigger>
                <SelectContent>
                  {JURIDIQUE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="description">Description (optionnel)</Label>
            <Textarea id="description" name="description" rows={3} maxLength={500} />
          </div>
          <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
            <div className="font-medium text-sm">Coordonnées de l'organisme de formation</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="of-email-admin">E-mail de l'OF</Label>
                <Input id="of-email-admin" name="organisme_email" type="email" />
              </div>
              <div>
                <Label htmlFor="of-tel-admin">Téléphone de l'OF</Label>
                <Input id="of-tel-admin" name="organisme_telephone" type="tel" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="of-site-admin">Site web</Label>
                <Input id="of-site-admin" name="site_web" type="url" />
              </div>
            </div>
          </div>
          <Button type="submit" disabled={create.isPending} className="w-full">
            Créer le dossier
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
