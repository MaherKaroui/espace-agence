import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Plus, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/security")({
  head: () => ({ meta: [{ title: "Sécurité — Paramètres" }] }),
  beforeLoad: async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.user.id);
    const ok = roles?.some((r) => r.role === "admin" || r.role === "direction");
    if (!ok) throw redirect({ to: "/dashboard" });
  },
  component: SecurityPage,
});

function SecurityPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["security-settings"],
    queryFn: async () => (await supabase.from("security_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (settings && !form) setForm(settings); }, [settings, form]);

  const save = useMutation({
    mutationFn: async (patch: any) => {
      const { error } = await supabase.from("security_settings").update(patch).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Paramètres enregistrés"); qc.invalidateQueries({ queryKey: ["security-settings"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!form) return <div className="p-8 text-muted-foreground">Chargement…</div>;

  const update = (patch: any) => setForm({ ...form, ...patch });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><ShieldCheck className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="font-display text-3xl">Sécurité anti-détournement</h1>
          <p className="text-muted-foreground text-sm">Filtres appliqués automatiquement aux messages envoyés sur la plateforme.</p>
        </div>
      </div>

      <Card className="p-6 space-y-5">
        <ToggleRow label="Masquer les numéros de téléphone dans les messages" checked={form.mask_phones} onChange={(v) => update({ mask_phones: v })} />
        <ToggleRow label="Masquer les adresses e-mail dans les messages" checked={form.mask_emails} onChange={(v) => update({ mask_emails: v })} />
        <ToggleRow label="Filtrer les mots-clés interdits (WhatsApp, Telegram…)" checked={form.filter_keywords} onChange={(v) => update({ filter_keywords: v })} />
        <div className="space-y-2">
          <label className="text-sm font-medium">Mots-clés interdits</label>
          <KeywordEditor
            keywords={form.blocked_keywords ?? []}
            onChange={(kws: string[]) => update({ blocked_keywords: kws })}
          />
          <p className="text-xs text-muted-foreground">Ajoutez un mot-clé et validez avec Entrée. Cliquez sur × pour retirer.</p>
        </div>

      </Card>

      <Card className="p-6 space-y-5">
        <ToggleRow label="Restreindre les échanges aux heures ouvrées" checked={form.business_hours_only} onChange={(v) => update({ business_hours_only: v })} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm">Début</label>
            <Input type="time" value={form.business_hours_start?.slice(0, 5) ?? "08:00"} onChange={(e) => update({ business_hours_start: e.target.value })} />
          </div>
          <div>
            <label className="text-sm">Fin</label>
            <Input type="time" value={form.business_hours_end?.slice(0, 5) ?? "19:00"} onChange={(e) => update({ business_hours_end: e.target.value })} />
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate({
          mask_phones: form.mask_phones,
          mask_emails: form.mask_emails,
          filter_keywords: form.filter_keywords,
          blocked_keywords: form.blocked_keywords,
          business_hours_only: form.business_hours_only,
          business_hours_start: form.business_hours_start,
          business_hours_end: form.business_hours_end,
        })} disabled={save.isPending}>Enregistrer</Button>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
