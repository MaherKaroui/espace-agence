import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface RelanceButtonProps {
  clientId: string;
  clientEmail?: string | null;
  dossierId?: string;
  dossierTitre?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  label?: string;
}

const DEFAULT_MESSAGE =
  "Bonjour, sans nouvelle de votre part, nous vous relançons concernant votre dossier. Merci de nous répondre dès que possible.";

export function RelanceButton({
  clientId, clientEmail, dossierId, dossierTitre,
  variant = "outline", size = "default", label = "Relancer",
}: RelanceButtonProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(DEFAULT_MESSAGE);
  const [sendEmail, setSendEmail] = useState(true);

  const mut = useMutation({
    mutationFn: async () => {
      // 1) Message dans le chat (déclenche notification + audit via triggers)
      const { error: mErr } = await supabase.from("messages").insert({
        client_id: clientId,
        sender_id: user!.id,
        from_agence: true,
        content,
      });
      if (mErr) throw mErr;

      // 2) E-mail (best-effort — nécessite domaine configuré)
      let emailStatus: "sent" | "skipped" | "not_configured" = "skipped";
      if (sendEmail && clientEmail) {
        try {
          const { sendTransactionalEmail } = await import("@/lib/email/send");
          const ok = await sendTransactionalEmail({
            templateName: "relance-client",
            recipientEmail: clientEmail,
            idempotencyKey: `relance-${dossierId ?? clientId}-${Date.now()}`,
            templateData: {
              prenom: undefined,
              dossierTitre: dossierTitre ?? "votre dossier",
              message: content,
            },
          });
          emailStatus = ok ? "sent" : "not_configured";
        } catch {
          emailStatus = "not_configured";
        }
      }

      // 3) Journalisation
      await supabase.rpc("log_event", {
        _action: "relance.sent",
        _entity_type: dossierId ? "dossier" : "client",
        _entity_id: dossierId ?? clientId,
        _severity: "info",
        _metadata: { via_email: emailStatus, has_email: !!clientEmail },
      });

      return emailStatus;
    },
    onSuccess: (emailStatus) => {
      setOpen(false);
      if (emailStatus === "sent") toast.success("Relance envoyée (message + e-mail)");
      else if (emailStatus === "not_configured")
        toast.success("Relance envoyée par messagerie", {
          description: "E-mail non envoyé : domaine expéditeur non configuré.",
        });
      else toast.success("Relance envoyée par messagerie");
    },
    onError: (e: any) => toast.error(e.message ?? "Échec de la relance"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          <Bell className="h-4 w-4 mr-2" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Relancer le client</DialogTitle>
          <DialogDescription>
            Un message sera publié dans la conversation du client
            {dossierTitre ? ` (dossier : ${dossierTitre})` : ""}, avec notification.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={sendEmail}
              onCheckedChange={(v) => setSendEmail(v === true)}
              disabled={!clientEmail}
            />
            Envoyer aussi par e-mail {clientEmail ? `à ${clientEmail}` : "(aucun e-mail client)"}
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !content.trim()}>
            {mut.isPending ? "Envoi…" : "Envoyer la relance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
