import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { sendTransactionalEmail } from "@/lib/email/send";
import { Mail, Send, CheckCircle2, AlertCircle, XCircle, Clock, Search, Eye, BellRing } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { previewEmailTemplate } from "@/lib/preview-email.functions";
import { listNotificationRecipientHistory } from "@/lib/team.functions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { APP_URL } from "@/lib/app-url";
import { WebPushToggle } from "@/components/web-push-toggle";

export const Route = createFileRoute("/_authenticated/admin/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications & emails — IZISuivis" },
      { name: "description", content: "Gestion des emails automatiques, notifications navigateur et historique d'envoi IZISuivis." },
      { property: "og:title", content: "Notifications & emails — IZISuivis" },
      { property: "og:description", content: "Gestion des emails automatiques, notifications navigateur et historique d'envoi IZISuivis." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const ok = roles?.some((r) => ["admin", "direction"].includes(r.role));
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: AdminNotifications,
});

type LogRow = {
  id: string;
  message_id: string | null;
  template_name: string | null;
  recipient_email: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

const STATUS_META: Record<string, { label: string; cls: string; Icon: any }> = {
  sent: { label: "Envoyé", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 },
  pending: { label: "En attente", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30", Icon: Clock },
  failed: { label: "Erreur", cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30", Icon: AlertCircle },
  dlq: { label: "Échec définitif", cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30", Icon: XCircle },
  suppressed: { label: "Bloqué", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", Icon: AlertCircle },
};

function displayRecipient(email: string | null) {
  if (!email) return "—";
  return email.replace(/@izisuivis\.com$/i, "@izi-business.com").replace(/@izibusiness\.com$/i, "@izi-business.com");
}

function displayError(message: string | null) {
  if (!message) return null;
  if (message.includes("domain_not_verified") || message.includes("no_matching_sender")) {
    return "Ancienne erreur de domaine email avant correction.";
  }
  return message;
}

function AdminNotifications() {
  const qc = useQueryClient();
  const [testEmail, setTestEmail] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ html: string; subject: string; displayName: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const runPreview = useServerFn(previewEmailTemplate);
  const listNotificationHistoryFn = useServerFn(listNotificationRecipientHistory);

  const openPreview = async (templateName: string) => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const res = await runPreview({ data: { templateName } });
      setPreviewData(res);
    } catch (e: any) {
      toast.error(e?.message ?? "Impossible de générer l'aperçu");
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ["email-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("email_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data ?? { id: 1, admin_email: "admin@izi-business.com", disabled_templates: [] as string[] };
    },
  });

  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ["email-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_send_log")
        .select("id, message_id, template_name, recipient_email, status, error_message, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
    refetchInterval: 15000,
  });

  const { data: notificationHistory = [], isLoading: loadingNotificationHistory } = useQuery({
    queryKey: ["admin-notifications-recipient-history"],
    queryFn: () => listNotificationHistoryFn(),
    refetchInterval: 15000,
  });

  // Dedupe by message_id (keep latest status per email)
  const dedupedLogs = useMemo(() => {
    const seen = new Set<string>();
    const out: LogRow[] = [];
    for (const l of logs) {
      const k = l.message_id || l.id;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(l);
    }
    return out;
  }, [logs]);

  const stats = useMemo(() => {
    const s = { total: dedupedLogs.length, sent: 0, failed: 0, pending: 0, suppressed: 0 };
    for (const l of dedupedLogs) {
      if (l.status === "sent") s.sent++;
      else if (l.status === "dlq" || l.status === "failed") s.failed++;
      else if (l.status === "pending") s.pending++;
      else if (l.status === "suppressed") s.suppressed++;
    }
    return s;
  }, [dedupedLogs]);

  const filteredLogs = useMemo(() => {
    return dedupedLogs.filter((l) => {
      if (statusFilter !== "all") {
        if (statusFilter === "failed" && l.status !== "dlq" && l.status !== "failed") return false;
        if (statusFilter !== "failed" && l.status !== statusFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          l.template_name?.toLowerCase().includes(q) ||
          l.recipient_email?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [dedupedLogs, statusFilter, search]);

  const saveSettings = useMutation({
    mutationFn: async (patch: Partial<{ admin_email: string; disabled_templates: string[] }>) => {
      const { error } = await supabase.from("email_settings").update(patch).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Réglages sauvegardés");
      qc.invalidateQueries({ queryKey: ["email-settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleTemplate = (name: string, enabled: boolean) => {
    const current = settings?.disabled_templates ?? [];
    const next = enabled ? current.filter((t: string) => t !== name) : [...current, name];
    saveSettings.mutate({ disabled_templates: next });
  };

  const sendTest = async () => {
    if (!testEmail) return toast.error("Renseignez une adresse email");
    const ok = await sendTransactionalEmail({
      templateName: "welcome-client",
      recipientEmail: testEmail,
      idempotencyKey: `test-${Date.now()}`,
      templateData: { prenom: "Test", appUrl: APP_URL },
    });
    if (ok) {
      toast.success("Email de test envoyé (voir historique)");
      qc.invalidateQueries({ queryKey: ["email-logs"] });
    } else toast.error("Échec de l'envoi. Vérifiez la configuration email.");
  };

  const templateEntries = Object.entries(TEMPLATES);
  const clientTemplates = templateEntries.filter(([k]) => k.startsWith("client-") || k === "welcome-client");
  const adminTemplates = templateEntries.filter(([k]) => k.startsWith("admin-"));
  const disabled = new Set(settings?.disabled_templates ?? []);

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <Breadcrumbs items={[{ label: "Organisation" }, { label: "Notifications & emails" }]} />
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5"><Mail className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="font-display text-2xl">Notifications & emails</h1>
          <p className="text-sm text-muted-foreground">Réglez les emails automatiques, les notifications navigateur et leur historique.</p>
        </div>
      </div>

      <Tabs defaultValue="settings" className="w-full">
        <TabsList>
          <TabsTrigger value="settings">Réglages</TabsTrigger>
          <TabsTrigger value="history">Historique ({stats.total})</TabsTrigger>
          <TabsTrigger value="internal">Cloche ({notificationHistory.length})</TabsTrigger>
          <TabsTrigger value="test">Test</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="space-y-4 mt-4">
          <Card className="p-6 space-y-4">
            <div>
              <h2 className="font-semibold">Notifications navigateur / PC</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Activation par utilisateur : chaque membre autorise son navigateur, l'abonnement est sauvegardé de façon sécurisée, et la cloche interne reste le secours si le navigateur refuse.
              </p>
            </div>
            <WebPushToggle />
          </Card>

          <Card className="p-6 space-y-4">
            <div>
              <h2 className="font-semibold">Adresse admin principale</h2>
              <p className="text-xs text-muted-foreground mt-1">Destinataire par défaut des notifications adressées à l'agence.</p>
            </div>
            <div className="flex gap-2 max-w-md">
              <Input
                type="email"
                defaultValue={settings?.admin_email ?? "admin@izi-business.com"}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== settings?.admin_email) saveSettings.mutate({ admin_email: v });
                }}
                placeholder="admin@izi-business.com"
                disabled={loadingSettings}
              />
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <div>
              <h2 className="font-semibold">Emails clients automatiques</h2>
              <p className="text-xs text-muted-foreground mt-1">Envoyés à chaque étape importante d'un dossier.</p>
            </div>
            <div className="space-y-3">
              {clientTemplates.map(([key, tpl]) => (
                <div key={key} className="flex items-center justify-between border-b pb-3 last:border-0 gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{tpl.displayName ?? key}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{key}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openPreview(key)} className="gap-1">
                      <Eye className="h-3.5 w-3.5" /> Aperçu
                    </Button>
                    <Switch checked={!disabled.has(key)} onCheckedChange={(v) => toggleTemplate(key, v)} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <div>
              <h2 className="font-semibold">Notifications agence</h2>
              <p className="text-xs text-muted-foreground mt-1">Envoyées à l'adresse admin ci-dessus.</p>
            </div>
            <div className="space-y-3">
              {adminTemplates.map(([key, tpl]) => (
                <div key={key} className="flex items-center justify-between border-b pb-3 last:border-0 gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{tpl.displayName ?? key}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{key}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openPreview(key)} className="gap-1">
                      <Eye className="h-3.5 w-3.5" /> Aperçu
                    </Button>
                    <Switch checked={!disabled.has(key)} onCheckedChange={(v) => toggleTemplate(key, v)} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4"><div className="text-xs text-muted-foreground">Total</div><div className="text-2xl font-semibold">{stats.total}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Envoyés</div><div className="text-2xl font-semibold text-emerald-600">{stats.sent}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Erreurs</div><div className="text-2xl font-semibold text-red-600">{stats.failed}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Bloqués</div><div className="text-2xl font-semibold text-amber-600">{stats.suppressed}</div></Card>
          </div>
          <Card className="p-4">
            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Rechercher (template ou email)" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="flex gap-2">
                {["all", "sent", "failed", "pending", "suppressed"].map((s) => (
                  <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
                    {s === "all" ? "Tous" : STATUS_META[s]?.label ?? s}
                  </Button>
                ))}
              </div>
            </div>
            <div className="divide-y">
              {loadingLogs ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Chargement…</div>
              ) : filteredLogs.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Aucun email pour ce filtre.</div>
              ) : filteredLogs.slice(0, 100).map((l) => {
                const meta = STATUS_META[l.status] ?? { label: l.status, cls: "bg-muted", Icon: Mail };
                const Icon = meta.Icon;
                return (
                  <div key={l.id} className="py-3 flex items-start gap-3">
                    <Badge variant="outline" className={meta.cls + " gap-1"}><Icon className="h-3 w-3" />{meta.label}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{l.template_name || "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {displayRecipient(l.recipient_email)} · {formatDistanceToNow(new Date(l.created_at), { addSuffix: true, locale: fr })}
                      </div>
                      {displayError(l.error_message) && (
                        <div className="text-xs text-red-600 mt-1 truncate">{displayError(l.error_message)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="internal" className="space-y-4 mt-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <BellRing className="h-4 w-4 text-primary" />
              <div>
                <h2 className="font-semibold text-sm">Historique cloche interne</h2>
                <p className="text-xs text-muted-foreground">Chaque ligne correspond à un destinataire réel.</p>
              </div>
            </div>
            <div className="divide-y">
              {loadingNotificationHistory ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Chargement…</div>
              ) : notificationHistory.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Aucune notification interne.</div>
              ) : notificationHistory.map((n) => (
                <div key={n.id} className="py-3 flex items-start gap-3">
                  <Badge variant="outline" className="shrink-0">{n.type}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{n.titre}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {n.recipient_name ? `${n.recipient_name} · ` : ""}{displayRecipient(n.recipient_email)} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: fr })}
                    </div>
                    {n.message && <div className="text-xs text-muted-foreground truncate mt-1">{n.message}</div>}
                  </div>
                  <Badge variant="outline" className={n.read_at ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary border-primary/30"}>
                    {n.read_at ? "Lu" : "Non lu"}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="test" className="space-y-4 mt-4">
          <Card className="p-6 space-y-4 max-w-md">
            <div>
              <h2 className="font-semibold">Envoyer un email test</h2>
              <p className="text-xs text-muted-foreground mt-1">Envoie le template « Bienvenue » à l'adresse indiquée pour vérifier la configuration.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="test-email">Adresse email</Label>
              <Input id="test-email" type="email" placeholder="votre-email@exemple.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
            </div>
            <Button onClick={sendTest} className="gap-2"><Send className="h-4 w-4" />Envoyer le test</Button>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{previewData?.displayName ?? "Aperçu email"}</DialogTitle>
            <DialogDescription>
              {previewData ? <>Objet : <span className="font-medium text-foreground">{previewData.subject}</span></> : "Chargement de l'aperçu…"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto border rounded-md bg-white">
            {previewLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Génération de l'aperçu…</div>
            ) : previewData ? (
              <iframe title="Aperçu email" srcDoc={previewData.html} className="w-full h-[70vh]" sandbox="" />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
