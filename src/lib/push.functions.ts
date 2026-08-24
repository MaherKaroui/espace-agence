import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SubSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  user_agent: z.string().optional().nullable(),
});

const StatusSchema = z.object({
  endpoint: z.string().url().optional().nullable(),
});

export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  return { key: process.env.VAPID_PUBLIC_KEY ?? "" };
});

export const getPushSubscriptionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StatusSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { count, error: countError } = await supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) throw new Error(countError.message);

    let currentDeviceSaved = false;
    if (data.endpoint) {
      const { data: existing, error: existingError } = await supabase
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .eq("endpoint", data.endpoint)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      currentDeviceSaved = !!existing;
    }

    return { total: count ?? 0, currentDeviceSaved };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SubSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("save_push_subscription", {
      _endpoint: data.endpoint,
      _p256dh: data.p256dh,
      _auth: data.auth,
      _user_agent: data.user_agent ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ endpoint: z.string().url() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Couverture push de l'équipe (qui a activé, qui n'a pas).
 * Lecture via le client de l'utilisateur (RLS) : réservé admin/direction par les
 * politiques existantes sur profiles / push_subscriptions / push_delivery_logs.
 */
export const getTeamPushCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const { data: roles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("user_id, role");
    if (rolesErr) throw new Error(rolesErr.message);

    const staffRoles = new Set(["admin", "direction", "manager", "consultant", "auditeur", "certificateur"]);
    const staffIds = Array.from(
      new Set((roles ?? []).filter((r: any) => staffRoles.has(r.role)).map((r: any) => r.user_id as string)),
    );
    if (staffIds.length === 0) return { members: [] as any[] };

    const [{ data: profiles }, { data: subs }, { data: logs }] = await Promise.all([
      supabase.from("profiles").select("id, prenom, nom, email").in("id", staffIds),
      supabase.from("push_subscriptions").select("user_id").in("user_id", staffIds),
      supabase
        .from("push_delivery_logs")
        .select("user_id, sent_at, status")
        .in("user_id", staffIds)
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(2000),
    ]);

    const deviceCount = new Map<string, number>();
    for (const s of subs ?? []) deviceCount.set(s.user_id, (deviceCount.get(s.user_id) ?? 0) + 1);
    const lastSent = new Map<string, string>();
    for (const l of logs ?? []) if (!lastSent.has(l.user_id)) lastSent.set(l.user_id, l.sent_at);

    const rolesByUser = new Map<string, string[]>();
    for (const r of roles ?? []) {
      if (!staffRoles.has((r as any).role)) continue;
      const arr = rolesByUser.get((r as any).user_id) ?? [];
      arr.push((r as any).role);
      rolesByUser.set((r as any).user_id, arr);
    }

    const members = (profiles ?? [])
      .map((p: any) => ({
        id: p.id as string,
        name: `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || (p.email ?? "—"),
        email: (p.email ?? "") as string,
        roles: rolesByUser.get(p.id) ?? [],
        devices: deviceCount.get(p.id) ?? 0,
        last_sent_at: lastSent.get(p.id) ?? null,
      }))
      .sort((a, b) => a.devices - b.devices || a.name.localeCompare(b.name));

    return { members };
  });
