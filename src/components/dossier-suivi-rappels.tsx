import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { fr } from "date-fns/locale";
import { Bell, CheckCircle2, AlertTriangle, Clock, User, Send, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { listAssignableStaffForDossier } from "@/lib/dossier-suivi.functions";

const ANTI_SPAM_HOURS = 24;
const DEFAULT_MESSAGE =
  "Bonjour, sans nouvelle de votre part, nous vous relançons concernant votre dossier. Merci de nous répondre dès que possible.";

interface Props {
  dossierId: string;
  clientId: string | null;
  clientEmail?: string | null;
  dossierTitre: string;
  responsableId?: string | null;
  prochaineAction?: string | null;
  lastRelanceAt?: string | null;
}

interface RelanceEvent {
  id: string;
  created_at: string;
  action: string;
  metadata: any;
  user_id: string | null;
}

export function DossierSuiviRappels({
  dossierId, clientId, clientEmail, dossierTitre,
  responsableId, prochaineAction, lastRelanceAt,
}: Props) {
  const { user } = useAuth();
  const { isStaff } = useRole();
  const qc = useQueryClient();

  const [action, setAction] = useState(prochaineAction ?? "");
  const [respId, setRespId] = useState<string>(responsableId ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [sendEmail, setSendEmail] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => { setAction(prochaineAction ?? ""); }, [prochaineAction]);
  useEffect(() => { setRespId(responsableId ?? ""); }, [responsableId]);

  // Staff assignables (via server fn — pôle + admins + direction)
  const fetchStaff = useServerFn(listAssignableStaffForDossier);
  const { data: staffList = [] } = useQuery({
    queryKey: ["dossier-staff", dossierId],
    enabled: isStaff,
    queryFn: () => fetchStaff({ data: { dossierId } }),
  });

  const responsable = useMemo(
    () => staffList.find((s) => s.id === respId),
    [staffList, respId],
  );

  // Historique — audit_logs pour ce dossier (relance + rappels cron)
  const { data: events = [] } = useQuery({
    queryKey: ["dossier-relances", dossierId],
    enabled: isStaff,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("id, created_at, action, metadata, user_id")
        .eq("entity_type", "dossier")
        .eq("entity_id", dossierId)
        .in("action", ["relance.sent", "reminder.document", "reminder.dossier_inactif", "reminder.rdv"])
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []) as RelanceEvent[];
    },
  });

  const lastEvent = events[0];

  const hoursSinceLast = useMemo(() => {
    const src = lastRelanceAt ?? lastEvent?.created_at;
    if (!src) return Infinity;
    return (Date.now() - new Date(src).getTime()) / 36e5;
  }, [lastRelanceAt, lastEvent?.created_at]);

  const canRelance = hoursSinceLast >= ANTI_SPAM_HOURS;
  const nextAllowedIn = ANTI_SPAM_HOURS - hoursSinceLast;

  // Save responsable / prochaine action
  const saveMut = useMutation({
    mutationFn: async (patch: { responsable_id?: string | null; prochaine_action?: string | null }) => {
      const { error } = await supabase.from("dossiers").update(patch).eq("id", dossierId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dossier", dossierId] });
      toast.success("Suivi mis à jour");
    },
    onError: (e: any) => toast.error(e.message ?? "Impossible d'enregistrer"),
  });

  // Relance
  const relanceMut = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("Client manquant");
      // 1) message dans la conversation
      const { error: mErr } = await supabase.from("messages").insert({
        client_id: clientId, sender_id: user!.id, from_agence: true, content: message,
      });
      if (mErr) throw mErr;

      // 2) email best-effort
      let emailStatus: "sent" | "skipped" | "error" = "skipped";
      let emailError: string | null = null;
      if (sendEmail && clientEmail) {
        try {
          const { sendTransactionalEmail } = await import("@/lib/email/send");
          const ok = await sendTransactionalEmail({
            templateName: "relance-client",
            recipientEmail: clientEmail,
            idempotencyKey: `relance-${dossierId}-${Date.now()}`,
            templateData: { dossierTitre, message },
          });
          emailStatus = ok ? "sent" : "error";
          if (!ok) emailError = "Envoi email refusé (domaine ou template désactivé)";
        } catch (e: any) {
          emailStatus = "error";
          emailError = e?.message ?? "Erreur envoi email";
        }
      }

      // 3) journal + stamp anti-spam
      await supabase.rpc("log_event", {
        _action: "relance.sent",
        _entity_type: "dossier",
        _entity_id: dossierId,
        _severity: emailStatus === "error" ? "warning" : "info",
        _metadata: {
          via_email: emailStatus, has_email: !!clientEmail, email_error: emailError,
          message_excerpt: message.slice(0, 140),
        },
      });
      await supabase.from("dossiers").update({ last_relance_at: new Date().toISOString() }).eq("id", dossierId);

      return { emailStatus, emailError };
    },
    onSuccess: ({ emailStatus }) => {
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["dossier", dossierId] });
      qc.invalidateQueries({ queryKey: ["dossier-relances", dossierId] });
      if (emailStatus === "sent") toast.success("Relance envoyée (message + e-mail)");
      else if (emailStatus === "error") toast.warning("Message envoyé, e-mail non envoyé");
      else toast.success("Relance envoyée par messagerie");
    },
    onError: (e: any) => toast.error(e.message ?? "Échec de la relance"),
  });

  // Vue client — simplifiée en lecture seule
  if (!isStaff) {
    if (!responsableId && !prochaineAction) return null;
    return (
      <Card className="p-4 border-l-4 border-l-gold">
        <div className="flex items-center gap-2 mb-2">
          <User className="h-4 w-4 text-gold" />
          <h3 className="font-medium text-sm">Suivi de votre dossier</h3>
        </div>
        {prochaineAction && (
          <p className="text-sm text-muted-foreground whitespace-pre-line">{prochaineAction}</p>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-5 border-l-4 border-l-primary">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Suivi & rappels</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)} className="gap-1.5">
          <History className="h-3.5 w-3.5" />
          <span className="text-xs">Historique ({events.length})</span>
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Responsable */}
        <div className="space-y-1.5">
          <Label className="text-xs">Responsable</Label>
          <Select
            value={respId || "none"}
            onValueChange={(v) => {
              const val = v === "none" ? null : v;
              setRespId(val ?? "");
              saveMut.mutate({ responsable_id: val });
            }}
          >
            <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Aucun —</SelectItem>
              {staffList.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.nom}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {responsable?.email && (
            <p className="text-[11px] text-muted-foreground">{responsable.email}</p>
          )}
        </div>

        {/* Anti-spam status */}
        <div className="space-y-1.5">
          <Label className="text-xs">Dernier rappel</Label>
          {lastEvent ? (
            <div className="text-sm space-y-0.5">
              <div className="flex items-center gap-2">
                {lastEvent.metadata?.via_email === "error" ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                )}
                <span className="capitalize">
                  {formatDistanceToNow(new Date(lastEvent.created_at), { addSuffix: true, locale: fr })}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {labelForAction(lastEvent.action)}
                {lastEvent.metadata?.via_email === "sent" && " · email envoyé"}
                {lastEvent.metadata?.via_email === "error" && " · email en erreur"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun rappel envoyé</p>
          )}
        </div>
      </div>

      {/* Prochaine action */}
      <div className="mt-4 space-y-1.5">
        <Label className="text-xs">Prochaine action attendue</Label>
        <Textarea
          rows={2}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          onBlur={() => {
            if ((action || null) !== (prochaineAction || null)) {
              saveMut.mutate({ prochaine_action: action.trim() || null });
            }
          }}
          placeholder="Ex. Le client doit renvoyer son Kbis à jour…"
        />
      </div>

      {/* Bouton relance */}
      <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {canRelance
            ? "Prêt à envoyer une relance"
            : `Anti-spam : prochaine relance dans ${Math.ceil(nextAllowedIn)}h`}
        </div>
        <Button
          size="sm"
          onClick={() => setDialogOpen(true)}
          disabled={!clientId || !canRelance}
          title={!clientId ? "Aucun client rattaché" : undefined}
        >
          <Send className="h-3.5 w-3.5 mr-1.5" />
          Relancer maintenant
        </Button>
      </div>

      {/* Dialog relance */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Relancer le client</DialogTitle>
            <DialogDescription>
              Un message sera publié dans la conversation du client (dossier : {dossierTitre}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Message</Label>
              <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
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
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button
              onClick={() => relanceMut.mutate()}
              disabled={relanceMut.isPending || !message.trim()}
            >
              {relanceMut.isPending ? "Envoi…" : "Envoyer la relance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog historique */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Historique des rappels</DialogTitle>
            <DialogDescription>{events.length} événement(s) enregistré(s)</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {events.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Aucun rappel envoyé pour ce dossier.
              </p>
            )}
            {events.map((e) => {
              const via = e.metadata?.via_email;
              const err = via === "error" || e.metadata?.email_error;
              return (
                <div key={e.id} className={cn(
                  "border rounded-md p-3 text-sm",
                  err && "border-destructive/40 bg-destructive/5",
                )}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium">
                      {err ? (
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      )}
                      {labelForAction(e.action)}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(e.created_at), "d MMM yyyy 'à' HH:mm", { locale: fr })}
                    </span>
                  </div>
                  {e.metadata?.message_excerpt && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      « {e.metadata.message_excerpt} »
                    </p>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-1 flex gap-2 flex-wrap">
                    {via === "sent" && <span className="text-emerald-700">email envoyé</span>}
                    {via === "skipped" && <span>email non envoyé</span>}
                    {via === "error" && <span className="text-destructive">email en erreur</span>}
                    {e.metadata?.email_error && (
                      <span className="text-destructive">· {String(e.metadata.email_error).slice(0, 120)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function labelForAction(a: string) {
  switch (a) {
    case "relance.sent": return "Relance manuelle";
    case "reminder.document": return "Rappel document";
    case "reminder.dossier_inactif": return "Rappel dossier inactif";
    case "reminder.rdv": return "Rappel rendez-vous";
    default: return a;
  }
}
