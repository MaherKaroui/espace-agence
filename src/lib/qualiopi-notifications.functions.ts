import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Marque la conversation d'audit (externe) d'un dossier comme lue pour l'utilisateur.
 */
export const markExternalConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dossierId: string }) =>
    z.object({ dossierId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: conv } = await supabase
      .from("internal_conversations")
      .select("id")
      .eq("type", "external" as any)
      .eq("dossier_id", data.dossierId)
      .maybeSingle();
    if (!conv) return { ok: true };
    await supabase
      .from("internal_conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", (conv as any).id)
      .eq("user_id", userId);
    return { ok: true };
  });

/**
 * Retourne un map dossier_id -> nb messages non-lus dans la conversation externe.
 * Ne renvoie que les dossiers auxquels l'utilisateur a accès.
 */
export const getExternalUnreadCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: members } = await supabase
      .from("internal_conversation_members")
      .select("conversation_id, last_read_at")
      .eq("user_id", userId);
    const memberRows = (members ?? []) as any[];
    if (memberRows.length === 0) return {} as Record<string, number>;

    const convIds = memberRows.map((m) => m.conversation_id);
    const { data: convs } = await supabase
      .from("internal_conversations")
      .select("id, type, dossier_id")
      .in("id", convIds)
      .eq("type", "external" as any);
    const extRows = ((convs ?? []) as any[]).filter((c) => c.dossier_id);
    if (extRows.length === 0) return {} as Record<string, number>;

    const lastReadByConv = new Map<string, string | null>(
      memberRows.map((m) => [m.conversation_id, m.last_read_at]),
    );

    // Fetch messages once, then count client-side (bounded volume per audit chat).
    const extConvIds = extRows.map((c) => c.id);
    const { data: msgs } = await supabase
      .from("internal_messages")
      .select("conversation_id, sender_id, created_at")
      .in("conversation_id", extConvIds);

    const counts: Record<string, number> = {};
    for (const c of extRows) counts[c.dossier_id] = 0;
    for (const m of ((msgs ?? []) as any[])) {
      if (m.sender_id === userId) continue;
      const lastRead = lastReadByConv.get(m.conversation_id);
      if (lastRead && new Date(m.created_at) <= new Date(lastRead)) continue;
      const conv = extRows.find((c) => c.id === m.conversation_id);
      if (!conv) continue;
      counts[conv.dossier_id] = (counts[conv.dossier_id] ?? 0) + 1;
    }
    return counts;
  });

/**
 * Envoie une relance sur une demande Qualiopi.
 * - Anti-spam 24h (sauf force=true).
 * - Notifie tous les acteurs du dossier sauf le demandeur.
 * - Journalise dans qualiopi_request_events.
 */
export const sendQualiopiReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { requestId: string; force?: boolean }) =>
    z.object({ requestId: z.string().uuid(), force: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: req } = await supabase
      .from("qualiopi_requests" as any)
      .select("id, dossier_id, statut, last_reminder_at, indicator_id, requested_by, due_date")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req) throw new Error("Demande introuvable");
    const r: any = req;

    // Permission : participant du dossier (RLS SELECT confirme déjà)
    if (r.statut === "validee") throw new Error("Pièce déjà validée");

    // Anti-spam 24h
    if (!data.force && r.last_reminder_at) {
      const diff = Date.now() - new Date(r.last_reminder_at).getTime();
      if (diff < 24 * 3600 * 1000) {
        throw new Error("Relance déjà envoyée dans les dernières 24 heures");
      }
    }

    const { data: ind } = await supabase
      .from("qualiopi_indicators")
      .select("numero, libelle_court")
      .eq("id", r.indicator_id)
      .maybeSingle();

    const overdue = r.due_date && new Date(r.due_date) < new Date();
    const notifType = overdue ? "qualiopi_retard" : "qualiopi_echeance";
    const titre = overdue
      ? `Retard — Pièce Qualiopi Ind. ${(ind as any)?.numero ?? r.indicator_id}`
      : `Rappel — Pièce Qualiopi Ind. ${(ind as any)?.numero ?? r.indicator_id}`;
    const message = `${(ind as any)?.libelle_court ?? ""}${r.due_date ? ` · Échéance ${new Date(r.due_date).toLocaleDateString("fr-FR")}` : ""}`;

    // Push notifs via SECURITY DEFINER helper
    await supabase.rpc("qualiopi_notify_all" as any, {
      _dossier: r.dossier_id,
      _except: userId,
      _type: notifType,
      _titre: titre,
      _message: message,
    });

    // Marquer + journal
    await supabase
      .from("qualiopi_requests" as any)
      .update({ last_reminder_at: new Date().toISOString() })
      .eq("id", r.id);

    const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", userId).limit(1);
    const role = ((roleRow ?? []) as any[])[0]?.role ?? "client";

    await supabase.from("qualiopi_request_events" as any).insert({
      request_id: r.id,
      actor_id: userId,
      actor_role: role,
      action: "reminder_sent",
      meta: { overdue, due_date: r.due_date },
    });

    return { ok: true, overdue };
  });
