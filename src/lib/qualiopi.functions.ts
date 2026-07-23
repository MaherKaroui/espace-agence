import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertParticipant(supabase: any, userId: string, dossierId: string) {
  const { data: ok } = await supabase.rpc("qualiopi_dossier_participant", {
    _user: userId,
    _dossier: dossierId,
  });
  if (!ok) throw new Error("Accès refusé à ce dossier");
}

async function callerRole(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((data ?? []) as any[]).map((r) => r.role);
  return roles[0] ?? "client";
}

/** Liste les demandes Qualiopi d'un dossier avec documents et événements. */
export const listQualiopiRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dossierId: string }) => z.object({ dossierId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertParticipant(supabase, userId, data.dossierId);

    const [{ data: requests }, { data: indicators }, { data: criteria }] = await Promise.all([
      supabase.from("qualiopi_requests" as any).select("*").eq("dossier_id", data.dossierId).order("created_at", { ascending: false }),
      supabase.from("qualiopi_indicators").select("*").order("id"),
      supabase.from("qualiopi_criteria").select("*").order("id"),
    ]);

    const reqIds = ((requests ?? []) as any[]).map((r) => r.id);
    let docs: any[] = [];
    let events: any[] = [];
    if (reqIds.length > 0) {
      const [{ data: d }, { data: e }] = await Promise.all([
        supabase.from("qualiopi_request_documents" as any).select("*").in("request_id", reqIds).order("version", { ascending: false }),
        supabase.from("qualiopi_request_events" as any).select("*").in("request_id", reqIds).order("created_at", { ascending: false }),
      ]);
      docs = (d ?? []) as any[];
      events = (e ?? []) as any[];
    }

    // Auteurs/relecteurs
    const userIds = new Set<string>();
    ((requests ?? []) as any[]).forEach((r) => {
      if (r.requested_by) userIds.add(r.requested_by);
      if (r.reviewed_by) userIds.add(r.reviewed_by);
    });
    docs.forEach((d) => d.uploaded_by && userIds.add(d.uploaded_by));
    events.forEach((e) => e.actor_id && userIds.add(e.actor_id));

    let profiles: any[] = [];
    if (userIds.size > 0) {
      const { data: pr } = await supabase
        .from("profiles")
        .select("id, prenom, nom, email")
        .in("id", Array.from(userIds));
      profiles = (pr ?? []) as any[];
    }

    return {
      requests: (requests ?? []) as any[],
      documents: docs,
      events,
      indicators: (indicators ?? []) as any[],
      criteria: (criteria ?? []) as any[],
      profiles,
    };
  });

/** Crée une nouvelle demande de pièce Qualiopi. */
export const createQualiopiRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dossierId: string; indicatorId: number; message: string; dueDate?: string | null }) =>
    z.object({
      dossierId: z.string().uuid(),
      indicatorId: z.number().int().min(1).max(32),
      message: z.string().trim().min(3).max(4000),
      dueDate: z.string().nullable().optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertParticipant(supabase, userId, data.dossierId);
    const role = await callerRole(supabase, userId);

    const { data: inserted, error } = await supabase
      .from("qualiopi_requests" as any)
      .insert({
        dossier_id: data.dossierId,
        indicator_id: data.indicatorId,
        requested_by: userId,
        message: data.message,
        due_date: data.dueDate ?? null,
        statut: "en_attente",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("qualiopi_request_events" as any).insert({
      request_id: (inserted as any).id,
      actor_id: userId,
      actor_role: role,
      action: "created",
      meta: { indicator_id: data.indicatorId, message: data.message },
    });

    return { id: (inserted as any).id };
  });

/** Enregistre un document déposé (le fichier est déjà uploadé côté client). */
export const registerQualiopiDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    requestId: string;
    storagePath: string;
    filename: string;
    mimeType?: string;
    fileSize?: number;
    sha256?: string;
  }) =>
    z.object({
      requestId: z.string().uuid(),
      storagePath: z.string().min(1),
      filename: z.string().min(1).max(500),
      mimeType: z.string().max(200).optional(),
      fileSize: z.number().int().min(0).max(524288000).optional(),
      sha256: z.string().length(64).optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: req } = await supabase
      .from("qualiopi_requests" as any)
      .select("id, dossier_id, statut")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req) throw new Error("Demande introuvable");
    await assertParticipant(supabase, userId, (req as any).dossier_id);
    const role = await callerRole(supabase, userId);

    // Version = max(version) + 1 sur la demande
    const { data: latest } = await supabase
      .from("qualiopi_request_documents" as any)
      .select("version")
      .eq("request_id", data.requestId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((latest as any)?.version ?? 0) + 1;

    const { data: doc, error } = await supabase
      .from("qualiopi_request_documents" as any)
      .insert({
        request_id: data.requestId,
        uploaded_by: userId,
        version: nextVersion,
        storage_path: data.storagePath,
        filename: data.filename,
        mime_type: data.mimeType ?? null,
        file_size: data.fileSize ?? null,
        sha256: data.sha256 ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Passer la demande en "deposee" (sauf si déjà validée)
    if ((req as any).statut !== "validee") {
      await supabase
        .from("qualiopi_requests" as any)
        .update({ statut: "deposee", refus_motif: null, reviewed_at: null, reviewed_by: null })
        .eq("id", data.requestId);
    }

    await supabase.from("qualiopi_request_events" as any).insert({
      request_id: data.requestId,
      actor_id: userId,
      actor_role: role,
      action: "document_uploaded",
      meta: { filename: data.filename, version: nextVersion, size: data.fileSize ?? null },
    });

    return { id: (doc as any).id, version: nextVersion };
  });

/** Valide ou refuse une demande. Motif obligatoire en cas de refus. */
export const reviewQualiopiRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { requestId: string; decision: "validee" | "refusee"; motif?: string }) =>
    z.object({
      requestId: z.string().uuid(),
      decision: z.enum(["validee", "refusee"]),
      motif: z.string().trim().max(2000).optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.decision === "refusee" && (!data.motif || data.motif.trim().length < 3)) {
      throw new Error("Un motif est requis pour refuser une pièce");
    }
    const { data: req } = await supabase
      .from("qualiopi_requests" as any)
      .select("id, dossier_id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req) throw new Error("Demande introuvable");
    await assertParticipant(supabase, userId, (req as any).dossier_id);
    const role = await callerRole(supabase, userId);

    const { error } = await supabase
      .from("qualiopi_requests" as any)
      .update({
        statut: data.decision,
        refus_motif: data.decision === "refusee" ? data.motif! : null,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.requestId);
    if (error) throw new Error(error.message);

    await supabase.from("qualiopi_request_events" as any).insert({
      request_id: data.requestId,
      actor_id: userId,
      actor_role: role,
      action: data.decision === "validee" ? "validated" : "refused",
      meta: data.decision === "refusee" ? { motif: data.motif } : {},
    });

    return { ok: true };
  });

/** Supprime une demande (admin/direction/auteur). */
export const deleteQualiopiRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { requestId: string }) => z.object({ requestId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("qualiopi_requests" as any).delete().eq("id", data.requestId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** URL signée pour télécharger un document. */
export const getQualiopiDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { documentId: string }) => z.object({ documentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc } = await supabase
      .from("qualiopi_request_documents" as any)
      .select("id, storage_path, request_id")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("Document introuvable");
    const { data: req } = await supabase
      .from("qualiopi_requests" as any)
      .select("dossier_id")
      .eq("id", (doc as any).request_id)
      .maybeSingle();
    if (!req) throw new Error("Demande introuvable");
    await assertParticipant(supabase, userId, (req as any).dossier_id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("qualiopi-files")
      .createSignedUrl((doc as any).storage_path, 600);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
