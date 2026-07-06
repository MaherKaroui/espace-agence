import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function ensureDirection(supabase: any, callerId: string) {
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId);
  const ok = !!roles?.some((r: any) => r.role === "admin" || r.role === "direction");
  if (!ok) throw new Error("Accès refusé");
}

/** Génère (ou régénère) le rapport quotidien. */
export const generateDailyDirectionReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { date?: string }) => z.object({ date: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureDirection(supabase, userId);
    const date = data.date ?? new Date().toISOString().slice(0, 10);
    const { data: rap, error } = await supabase.rpc("generer_rapport_direction", { _date: date });
    if (error) throw new Error(error.message);
    return { id: rap as string, date };
  });

/** Récupère le rapport archivé pour une date. */
export const getDirectionReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { date: string }) => z.object({ date: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureDirection(supabase, userId);
    const { data: rep, error } = await supabase
      .from("daily_direction_reports")
      .select("*")
      .eq("report_date", data.date)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return rep;
  });

/** Liste des rapports archivés. */
export const listDirectionReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureDirection(supabase, userId);
    const { data, error } = await supabase
      .from("daily_direction_reports")
      .select("id, report_date, generated_by, actions_count, active_users_count, messages_count, documents_count, dossiers_modified_count, relances_count, created_at")
      .order("report_date", { ascending: false })
      .limit(90);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Timeline chronologique détaillée pour une personne un jour donné. */
export const getUserActivityDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { date: string; userId: string }) =>
    z.object({ date: z.string(), userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureDirection(supabase, userId);

    const start = new Date(`${data.date}T00:00:00+01:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: logs, error } = await supabaseAdmin
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, severity, metadata, created_at")
      .eq("user_id", data.userId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // Enrichir avec titres dossiers, noms clients, contenu messages
    const dossierIds = new Set<string>();
    const messageIds = new Set<string>();
    const internalMsgIds = new Set<string>();
    const groupMsgIds = new Set<string>();
    const docIds = new Set<string>();
    const clientIds = new Set<string>();

    for (const l of logs ?? []) {
      if (l.entity_type === "dossier" && l.entity_id) dossierIds.add(l.entity_id);
      if (l.entity_type === "message" && l.entity_id) messageIds.add(l.entity_id);
      if (l.entity_type === "internal_message" && l.entity_id) internalMsgIds.add(l.entity_id);
      if (l.entity_type === "group_message" && l.entity_id) groupMsgIds.add(l.entity_id);
      if (l.entity_type === "document" && l.entity_id) docIds.add(l.entity_id);
      const m: any = l.metadata || {};
      if (m.client_id) clientIds.add(m.client_id);
      if (m.dossier_id) dossierIds.add(m.dossier_id);
    }

    const [{ data: dossiers }, { data: msgs }, { data: intMsgs }, { data: grpMsgs }, { data: docs }, { data: clients }] =
      await Promise.all([
        dossierIds.size
          ? supabaseAdmin.from("dossiers").select("id, titre, client_id").in("id", [...dossierIds])
          : Promise.resolve({ data: [] } as any),
        messageIds.size
          ? supabaseAdmin.from("messages").select("id, content, client_id, from_agence, attachment_name").in("id", [...messageIds])
          : Promise.resolve({ data: [] } as any),
        internalMsgIds.size
          ? supabaseAdmin.from("internal_messages").select("id, content, conversation_id, attachment_name").in("id", [...internalMsgIds])
          : Promise.resolve({ data: [] } as any),
        groupMsgIds.size
          ? supabaseAdmin.from("group_messages").select("id, content, conversation_id, attachment_name").in("id", [...groupMsgIds])
          : Promise.resolve({ data: [] } as any),
        docIds.size
          ? supabaseAdmin.from("documents").select("id, nom, dossier_id").in("id", [...docIds])
          : Promise.resolve({ data: [] } as any),
        clientIds.size
          ? supabaseAdmin.from("profiles").select("id, prenom, nom, email").in("id", [...clientIds])
          : Promise.resolve({ data: [] } as any),
      ]);

    const dMap = new Map((dossiers ?? []).map((x: any) => [x.id, x]));
    const mMap = new Map((msgs ?? []).map((x: any) => [x.id, x]));
    const imMap = new Map((intMsgs ?? []).map((x: any) => [x.id, x]));
    const gmMap = new Map((grpMsgs ?? []).map((x: any) => [x.id, x]));
    const docMap = new Map((docs ?? []).map((x: any) => [x.id, x]));
    const cMap = new Map((clients ?? []).map((x: any) => [x.id, x]));

    return (logs ?? []).map((l: any) => ({
      ...l,
      dossier: l.entity_type === "dossier" && l.entity_id ? dMap.get(l.entity_id) : null,
      message: l.entity_type === "message" && l.entity_id ? mMap.get(l.entity_id) : null,
      internal_message: l.entity_type === "internal_message" && l.entity_id ? imMap.get(l.entity_id) : null,
      group_message: l.entity_type === "group_message" && l.entity_id ? gmMap.get(l.entity_id) : null,
      document: l.entity_type === "document" && l.entity_id ? docMap.get(l.entity_id) : null,
      related_client: l.metadata?.client_id ? cMap.get(l.metadata.client_id) : null,
      related_dossier: l.metadata?.dossier_id ? dMap.get(l.metadata.dossier_id) : null,
    }));
  });

/** Liste des messages écrits un jour donné (tous types). */
export const getMessagesForDay = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { date: string; userId?: string; type?: string }) =>
    z.object({ date: z.string(), userId: z.string().uuid().optional(), type: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureDirection(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const start = new Date(`${data.date}T00:00:00+01:00`).toISOString();
    const end = new Date(new Date(`${data.date}T00:00:00+01:00`).getTime() + 24 * 3600_000).toISOString();

    const wantAll = !data.type || data.type === "all";

    const results: any[] = [];

    if (wantAll || data.type === "client") {
      let q = supabaseAdmin
        .from("messages")
        .select("id, sender_id, client_id, from_agence, content, attachment_name, created_at")
        .gte("created_at", start)
        .lt("created_at", end);
      if (data.userId) q = q.eq("sender_id", data.userId);
      const { data: rows } = await q;
      for (const r of rows ?? []) {
        results.push({ ...r, type: "client", sort: r.created_at });
      }
    }

    if (wantAll || data.type === "internal") {
      let q = supabaseAdmin
        .from("internal_messages")
        .select("id, sender_id, conversation_id, content, attachment_name, created_at")
        .gte("created_at", start)
        .lt("created_at", end);
      if (data.userId) q = q.eq("sender_id", data.userId);
      const { data: rows } = await q;
      for (const r of rows ?? []) results.push({ ...r, type: "internal", sort: r.created_at });
    }

    if (wantAll || data.type === "group") {
      let q = supabaseAdmin
        .from("group_messages")
        .select("id, sender_id, conversation_id, content, attachment_name, created_at")
        .gte("created_at", start)
        .lt("created_at", end);
      if (data.userId) q = q.eq("sender_id", data.userId);
      const { data: rows } = await q;
      for (const r of rows ?? []) results.push({ ...r, type: "group", sort: r.created_at });
    }

    // Enrich sender / client names
    const uids = new Set<string>();
    for (const r of results) {
      if (r.sender_id) uids.add(r.sender_id);
      if (r.client_id) uids.add(r.client_id);
    }
    const { data: profs } = uids.size
      ? await supabaseAdmin.from("profiles").select("id, prenom, nom, email").in("id", [...uids])
      : ({ data: [] } as any);
    const pMap = new Map((profs ?? []).map((p: any) => [p.id, p]));

    return results
      .map((r) => ({
        ...r,
        sender: pMap.get(r.sender_id),
        client: r.client_id ? pMap.get(r.client_id) : null,
      }))
      .sort((a, b) => (a.sort > b.sort ? -1 : 1));
  });
