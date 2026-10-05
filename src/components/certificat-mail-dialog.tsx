import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { sendCertificatMail } from "@/lib/certificat.functions";
import {
  CERTIFIER_DIRECTORY, buildCertMail, dateFr, defaultRecipients, detectCertifiers, nextCertAction,
  type CertMailEvent, type CertMailKind, type CertifierKey,
} from "@/lib/certificat-mails";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Mail, Plus, RefreshCw, Send, X, History, AlertTriangle } from "lucide-react";

export type CertMailTarget = CertMailEvent & { id: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CertificatMailDialog({
  event, onClose, onSent,
}: { event: CertMailTarget | null; onClose: () => void; onSent: () => void }) {
  const { user } = useAuth();
  const send = useServerFn(sendCertificatMail);

  const profileQ = useQuery({
    queryKey: ["certmail-profile", user?.id],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("prenom, nom, email, telephone").eq("id", user!.id).maybeSingle();
      return (data ?? { email: user?.email ?? null }) as { prenom?: string; nom?: string; email?: string | null; telephone?: string | null };
    },
  });

  const detected = useMemo(
    () => (event ? detectCertifiers(event.certifier_name, event.certifier_organization) : []),
    [event],
  );
  const action = useMemo(() => (event ? nextCertAction(event) : null), [event]);

  const [kind, setKind] = useState<CertMailKind>("demande");
  const [selected, setSelected] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [sending, setSending] = useState(false);

  // Réinitialisation à l'ouverture : action suggérée + destinataires du certificateur reconnu
  useEffect(() => {
    if (!event || !action) return;
    setKind(action.kind);
    const lastTo = action.last?.to.split(",").map((s) => s.trim()).filter((s) => EMAIL_RE.test(s)) ?? [];
    setSelected(lastTo.length > 0 ? lastTo : defaultRecipients(detected));
    setExtra("");
    setEdited(false);
    setShowOthers(detected.length === 0);
  }, [event?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rank = kind === "relance" ? (action?.history.filter((h) => h.kind === "relance").length ?? 0) + 1 : 0;

  const regenerate = React.useCallback(() => {
    if (!event) return;
    const m = buildCertMail({ kind, rank, event, recipients: selected, sender: profileQ.data ?? {} });
    setSubject(m.subject);
    setBody(m.body);
    setEdited(false);
  }, [event, kind, rank, selected, profileQ.data]);

  // Tant que le texte n'a pas été retouché, il suit le type d'envoi et les destinataires
  useEffect(() => { if (!edited) regenerate(); }, [regenerate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!event || !action) return null;

  const toggle = (email: string, on: boolean) =>
    setSelected((prev) => (on ? Array.from(new Set([...prev, email])) : prev.filter((e) => e !== email)));

  const addExtra = () => {
    const parts = extra.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    if (bad.length > 0) { toast.error(`Adresse invalide : ${bad.join(", ")}`); return; }
    setSelected((prev) => Array.from(new Set([...prev, ...parts])));
    setExtra("");
  };

  const directoryEmails = new Set(
    (Object.keys(CERTIFIER_DIRECTORY) as CertifierKey[]).flatMap((k) => CERTIFIER_DIRECTORY[k].contacts.map((c) => c.email)),
  );
  const customSelected = selected.filter((e) => !directoryEmails.has(e));
  const others = (Object.keys(CERTIFIER_DIRECTORY) as CertifierKey[]).filter((k) => !detected.includes(k));
  const auditInFuture = (action.sinceAudit ?? 0) < 0;

  const submit = async () => {
    if (selected.length === 0) { toast.error("Choisissez au moins un destinataire"); return; }
    setSending(true);
    try {
      const res = await send({ data: { eventId: event.id, kind, recipients: selected, subject, body } });
      if (res.sent.length > 0) {
        toast.success(`${kind === "demande" ? "Demande" : `Relance n°${res.rank}`} envoyée à ${res.sent.length} destinataire(s)`);
      }
      if (res.failed.length > 0) {
        toast.error(`Non envoyé : ${res.failed.map((f) => `${f.email} (${f.reason})`).join(", ")}`);
      }
      if (res.sent.length > 0) { onSent(); onClose(); }
    } catch (e: any) {
      toast.error(e?.message ?? "Envoi impossible");
    } finally {
      setSending(false);
    }
  };

  const renderContact = (k: CertifierKey) => (
    <div key={k} className="rounded-md border p-2 space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{CERTIFIER_DIRECTORY[k].label}</div>
      {CERTIFIER_DIRECTORY[k].contacts.map((c) => (
        <label key={c.email} className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={selected.includes(c.email)} onCheckedChange={(v) => toggle(c.email, v === true)} />
          <span className="truncate">{c.email}</span>
          <span className="text-xs text-muted-foreground">— {c.label}</span>
        </label>
      ))}
    </div>
  );

  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" /> Certificat — {event.organism_name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {event.audit_date && <Badge variant="outline">Audit du {dateFr(event.audit_date)}</Badge>}
            {event.formation && <Badge variant="outline">{event.formation}</Badge>}
            {event.auditor_name && <Badge variant="outline">Auditeur : {event.auditor_name}</Badge>}
            <Badge variant="outline">Certificateur : {event.certifier_name || event.certifier_organization || "non renseigné"}</Badge>
          </div>

          {auditInFuture && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              L'audit n'a pas encore eu lieu : le texte demande les modalités de délivrance plutôt que le certificat lui-même.
            </div>
          )}

          {action.history.length > 0 && (
            <div className="rounded-md border p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><History className="h-3.5 w-3.5" /> Déjà envoyé</div>
              {action.history.map((h, i) => (
                <div key={i} className="text-xs">
                  {dateFr(h.date)} — {h.kind === "demande" ? "Demande" : `Relance n°${h.rank}`} → {h.to}
                </div>
              ))}
              {action.sinceLast !== null && (
                <div className="text-xs text-muted-foreground">Dernier envoi il y a {action.sinceLast} jour(s).</div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant={kind === "demande" ? "default" : "outline"} onClick={() => setKind("demande")}>Demande de certificat</Button>
            <Button size="sm" variant={kind === "relance" ? "default" : "outline"} onClick={() => setKind("relance")}>
              Relance{kind === "relance" ? ` n°${rank}` : ""}
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Destinataires</Label>
            {detected.length === 0 && (
              <p className="text-xs text-muted-foreground">Certificateur non reconnu sur cette ligne : choisissez les adresses ou ajoutez-en une.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">{detected.map(renderContact)}</div>
            {others.length > 0 && (
              <button type="button" className="text-xs text-primary underline" onClick={() => setShowOthers((v) => !v)}>
                {showOthers ? "Masquer les autres certificateurs" : "Écrire aussi à un autre certificateur"}
              </button>
            )}
            {showOthers && <div className="grid gap-2 sm:grid-cols-2">{others.map(renderContact)}</div>}

            {customSelected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {customSelected.map((e) => (
                  <Badge key={e} variant="secondary" className="gap-1">
                    {e}
                    <button type="button" onClick={() => toggle(e, false)} aria-label={`Retirer ${e}`}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                placeholder="Ajouter une autre adresse (auditeur, chargé de dossier…)"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }}
              />
              <Button type="button" variant="outline" onClick={addExtra} disabled={!extra.trim()}><Plus className="h-4 w-4" /></Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Objet</Label>
              {edited && (
                <Button type="button" variant="ghost" size="sm" onClick={regenerate}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Régénérer le texte
                </Button>
              )}
            </div>
            <Input value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true); }} />
            <Label>Message</Label>
            <Textarea rows={14} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} />
            <p className="text-xs text-muted-foreground">
              Rédigé à partir de la ligne du calendrier. Les réponses du certificateur arriveront sur {profileQ.data?.email ?? "votre adresse"}.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={sending || selected.length === 0}>
            <Send className="h-4 w-4 mr-2" />
            {sending ? "Envoi…" : `Envoyer à ${selected.length} destinataire(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
