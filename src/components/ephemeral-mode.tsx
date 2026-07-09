import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Timer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type EphemeralScope =
  | { kind: "group"; conversationId: string }
  | { kind: "internal"; conversationId: string }
  | { kind: "client"; clientId: string };

type EphemeralState = {
  ephemeral_enabled: boolean;
  ephemeral_duration_seconds: number | null;
  ephemeral_members_can_edit: boolean;
};

const PRESETS: { label: string; seconds: number }[] = [
  { label: "5 minutes", seconds: 5 * 60 },
  { label: "30 minutes", seconds: 30 * 60 },
  { label: "1 heure", seconds: 60 * 60 },
  { label: "6 heures", seconds: 6 * 60 * 60 },
  { label: "12 heures", seconds: 12 * 60 * 60 },
  { label: "24 heures", seconds: 24 * 60 * 60 },
  { label: "3 jours", seconds: 3 * 24 * 60 * 60 },
  { label: "7 jours", seconds: 7 * 24 * 60 * 60 },
  { label: "30 jours", seconds: 30 * 24 * 60 * 60 },
];

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const preset = PRESETS.find((p) => p.seconds === seconds);
  if (preset) return preset.label;
  if (seconds % (24 * 3600) === 0) return `${seconds / 86400} jours`;
  if (seconds % 3600 === 0) return `${seconds / 3600} heures`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} s`;
}

function scopeKey(scope: EphemeralScope): (string | undefined)[] {
  return scope.kind === "client"
    ? ["ephemeral", "client", scope.clientId]
    : ["ephemeral", scope.kind, scope.conversationId];
}

async function fetchState(scope: EphemeralScope): Promise<EphemeralState> {
  if (scope.kind === "group") {
    const { data, error } = await supabase
      .from("conversations")
      .select("ephemeral_enabled, ephemeral_duration_seconds, ephemeral_members_can_edit")
      .eq("id", scope.conversationId)
      .maybeSingle();
    if (error) throw error;
    return {
      ephemeral_enabled: !!data?.ephemeral_enabled,
      ephemeral_duration_seconds: data?.ephemeral_duration_seconds ?? null,
      ephemeral_members_can_edit: !!data?.ephemeral_members_can_edit,
    };
  }
  if (scope.kind === "internal") {
    const { data, error } = await supabase
      .from("internal_conversations")
      .select("ephemeral_enabled, ephemeral_duration_seconds, ephemeral_members_can_edit")
      .eq("id", scope.conversationId)
      .maybeSingle();
    if (error) throw error;
    return {
      ephemeral_enabled: !!data?.ephemeral_enabled,
      ephemeral_duration_seconds: data?.ephemeral_duration_seconds ?? null,
      ephemeral_members_can_edit: !!data?.ephemeral_members_can_edit,
    };
  }
  const { data, error } = await supabase
    .from("client_ephemeral_settings")
    .select("ephemeral_enabled, ephemeral_duration_seconds")
    .eq("client_id", scope.clientId)
    .maybeSingle();
  if (error) throw error;
  return {
    ephemeral_enabled: !!data?.ephemeral_enabled,
    ephemeral_duration_seconds: data?.ephemeral_duration_seconds ?? null,
    ephemeral_members_can_edit: false,
  };
}

export function useEphemeralState(scope: EphemeralScope) {
  return useQuery({
    queryKey: scopeKey(scope),
    queryFn: () => fetchState(scope),
  });
}

/** Small badge shown at the top of a chat window when ephemeral mode is on. */
export function EphemeralBanner({ scope, className }: { scope: EphemeralScope; className?: string }) {
  const { data } = useEphemeralState(scope);
  if (!data?.ephemeral_enabled) return null;
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 text-xs bg-amber-500/10 border-b border-amber-500/30 text-amber-900 dark:text-amber-200",
      className,
    )}>
      <Flame className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        Mode éphémère activé — messages supprimés après {formatDuration(data.ephemeral_duration_seconds)}.
      </span>
    </div>
  );
}

export function EphemeralMessageIcon({ expiresAt }: { expiresAt: string | null | undefined }) {
  if (!expiresAt) return null;
  return (
    <Timer
      className="inline-block h-3 w-3 opacity-60 shrink-0"
      aria-label="Message éphémère"
    />
  );
}

export function EphemeralSettingsButton({
  scope,
  isGroupOwner,
  onSystemMessage,
}: {
  scope: EphemeralScope;
  /** For groups only: true if current user is owner of the group. Admin/direction is auto-detected. */
  isGroupOwner?: boolean;
  /** Optional hook to insert a system message on toggle. */
  onSystemMessage?: (text: string) => Promise<void> | void;
}) {
  const { user } = useAuth();
  const { isAdmin, isDirection } = useRole();
  const qc = useQueryClient();
  const { data } = useEphemeralState(scope);

  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [durationSel, setDurationSel] = useState<string>("86400");
  const [customValue, setCustomValue] = useState<number>(1);
  const [customUnit, setCustomUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [membersCanEdit, setMembersCanEdit] = useState(false);

  const isGroupScope = scope.kind === "group" || scope.kind === "internal";
  const canManage = useMemo(() => {
    if (!isGroupScope) return true; // 1:1 client ↔ agence : chaque participant peut
    if (isAdmin || isDirection) return true;
    if (isGroupOwner) return true;
    return !!data?.ephemeral_members_can_edit;
  }, [isGroupScope, isAdmin, isDirection, isGroupOwner, data?.ephemeral_members_can_edit]);

  const canToggleMembersOption = isGroupScope && (isAdmin || isDirection || isGroupOwner);

  const currentSeconds = data?.ephemeral_duration_seconds ?? null;

  const openDialog = () => {
    setEnabled(!!data?.ephemeral_enabled);
    setMembersCanEdit(!!data?.ephemeral_members_can_edit);
    if (currentSeconds && PRESETS.some((p) => p.seconds === currentSeconds)) {
      setDurationSel(String(currentSeconds));
    } else if (currentSeconds) {
      setDurationSel("custom");
      if (currentSeconds % 86400 === 0) { setCustomUnit("days"); setCustomValue(currentSeconds / 86400); }
      else if (currentSeconds % 3600 === 0) { setCustomUnit("hours"); setCustomValue(currentSeconds / 3600); }
      else { setCustomUnit("minutes"); setCustomValue(Math.max(1, Math.round(currentSeconds / 60))); }
    } else {
      setDurationSel("86400");
    }
    setOpen(true);
  };

  const resolveSeconds = (): number => {
    if (durationSel === "custom") {
      const mult = customUnit === "days" ? 86400 : customUnit === "hours" ? 3600 : 60;
      return Math.max(60, Math.floor(customValue) * mult);
    }
    return parseInt(durationSel, 10) || 86400;
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Non authentifié");
      const seconds = enabled ? resolveSeconds() : null;
      if (scope.kind === "group") {
        const patch: any = {
          ephemeral_enabled: enabled,
          ephemeral_duration_seconds: seconds,
        };
        if (canToggleMembersOption) patch.ephemeral_members_can_edit = membersCanEdit;
        const { error } = await supabase.from("conversations").update(patch).eq("id", scope.conversationId);
        if (error) throw error;
      } else if (scope.kind === "internal") {
        const patch: any = {
          ephemeral_enabled: enabled,
          ephemeral_duration_seconds: seconds,
        };
        if (canToggleMembersOption) patch.ephemeral_members_can_edit = membersCanEdit;
        const { error } = await supabase.from("internal_conversations").update(patch).eq("id", scope.conversationId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("client_ephemeral_settings").upsert({
          client_id: scope.clientId,
          ephemeral_enabled: enabled,
          ephemeral_duration_seconds: seconds,
          updated_by: user.id,
        });
        if (error) throw error;
      }

      // Optional system message
      if (onSystemMessage) {
        const msg = enabled
          ? `🔥 Mode éphémère activé — les messages seront supprimés après ${formatDuration(seconds)}.`
          : "Le mode éphémère a été désactivé.";
        try { await onSystemMessage(msg); } catch { /* ignore */ }
      }
    },
    onSuccess: () => {
      toast.success("Réglages enregistrés");
      qc.invalidateQueries({ queryKey: scopeKey(scope) });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Enregistrement impossible"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? openDialog() : setOpen(false))}>
      <DialogTrigger asChild>
        <Button
          variant={data?.ephemeral_enabled ? "default" : "outline"}
          size="icon"
          className={cn("relative", data?.ephemeral_enabled && "bg-amber-500 hover:bg-amber-600 text-white")}
          title="Mode éphémère"
          aria-label="Mode éphémère"
        >
          <Flame className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-amber-500" /> Mode éphémère
          </DialogTitle>
          <DialogDescription>
            Les nouveaux messages disparaissent automatiquement après la durée choisie. Fonctionne sur les
            textes, images, vidéos, documents et messages vocaux.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm">Activer le mode éphémère</Label>
              <p className="text-xs text-muted-foreground">
                Ne s'applique qu'aux nouveaux messages envoyés après activation.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canManage} />
          </div>

          {enabled && (
            <div className="space-y-2">
              <Label className="text-sm">Durée avant suppression</Label>
              <Select value={durationSel} onValueChange={setDurationSel} disabled={!canManage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.seconds} value={String(p.seconds)}>{p.label}</SelectItem>
                  ))}
                  <SelectItem value="custom">Personnalisé…</SelectItem>
                </SelectContent>
              </Select>

              {durationSel === "custom" && (
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={customValue}
                    onChange={(e) => setCustomValue(Math.max(1, parseInt(e.target.value || "1", 10)))}
                    disabled={!canManage}
                  />
                  <Select value={customUnit} onValueChange={(v) => setCustomUnit(v as any)} disabled={!canManage}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">minutes</SelectItem>
                      <SelectItem value="hours">heures</SelectItem>
                      <SelectItem value="days">jours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {canToggleMembersOption && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Les membres peuvent modifier</Label>
                <p className="text-xs text-muted-foreground">
                  Autoriser les membres (non-admins) à activer/désactiver le mode.
                </p>
              </div>
              <Switch checked={membersCanEdit} onCheckedChange={setMembersCanEdit} />
            </div>
          )}

          {!canManage && (
            <p className="text-xs text-muted-foreground">
              Seuls les administrateurs peuvent modifier ce réglage.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={!canManage || save.isPending}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
