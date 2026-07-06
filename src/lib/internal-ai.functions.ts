import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function ensureConversationAccess(supabase: any, userId: string, conversationId: string) {
  const { data: allowed, error } = await supabase.rpc("can_view_internal_conv", {
    _user: userId,
    _conv: conversationId,
  });
  if (error) throw new Error(error.message);
  if (!allowed) throw new Error("Accès refusé à cette conversation");
}

async function callLovableAi(messages: any[], model = "google/gemini-2.5-flash") {
  const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY manquant");
  const gateway = createLovableAiGatewayProvider(key);
  const { generateText } = await import("ai");
  const { text } = await generateText({ model: gateway(model), messages });
  return text;
}

/**
 * Résume la conversation interne (dernier bloc de messages).
 * Retourne un markdown : "## Décisions", "## Actions à faire", "## Points en attente".
 */
export const summarizeInternalConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ conversationId: z.string().uuid(), limit: z.number().int().min(5).max(200).default(80) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureConversationAccess(supabase, userId, data.conversationId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: msgs } = await supabaseAdmin
      .from("internal_messages")
      .select("id, sender_id, content, created_at")
      .eq("conversation_id", data.conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    const messages = ((msgs ?? []) as any[]).reverse().filter((m) => m.content);
    if (messages.length === 0) return { summary: "_Pas encore de message à résumer._" };

    const senderIds = Array.from(new Set(messages.map((m) => m.sender_id)));
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, prenom, nom, email")
      .in("id", senderIds);
    const nameById = new Map(
      ((profs ?? []) as any[]).map((p) => [
        p.id,
        `${p.prenom ?? ""} ${p.nom ?? ""}`.trim() || p.email || "Membre",
      ]),
    );

    // Nettoie le format @[Nom](user:uuid) -> @Nom / #[label](type:id) -> #label
    const clean = (t: string) =>
      t
        .replace(/@\[([^\]]+)\]\(user:[0-9a-f-]{36}\)/gi, "@$1")
        .replace(/#\[([^\]]+)\]\((?:client|dossier|task|pole):[0-9a-f-]{36}\)/gi, "#$1");

    const transcript = messages
      .map((m) => `${nameById.get(m.sender_id) ?? "Membre"} : ${clean(m.content)}`)
      .join("\n");

    const summary = await callLovableAi([
      {
        role: "system",
        content:
          "Tu es assistant d'une agence de conseil. Résume une conversation interne d'équipe en français, de manière concise et actionnable. Utilise EXACTEMENT ces sections markdown : `## Décisions`, `## Actions à faire`, `## Points en attente`. Pour les actions, mets une liste à puces avec la personne responsable en gras si mentionnée. Si une section est vide, écris `_Aucune._`. Pas d'introduction, pas de conclusion.",
      },
      { role: "user", content: `Voici la conversation (ordre chronologique) :\n\n${transcript}` },
    ]);

    return { summary, messageCount: messages.length };
  });

/**
 * Extrait une tâche depuis un message.
 * Retourne un brouillon : { title, description, priority, due_date }.
 */
export const extractTaskFromMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ messageId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: msg } = await supabaseAdmin
      .from("internal_messages")
      .select("id, content, conversation_id, sender_id, created_at")
      .eq("id", data.messageId)
      .maybeSingle();
    if (!msg) throw new Error("Message introuvable");
    await ensureConversationAccess(supabase, userId, msg.conversation_id);
    if (!msg.content) throw new Error("Message vide");

    const { data: conv } = await supabaseAdmin
      .from("internal_conversations")
      .select("type, titre, pole_id, client_id, dossier_id")
      .eq("id", msg.conversation_id)
      .maybeSingle();

    const clean = (msg.content as string)
      .replace(/@\[([^\]]+)\]\(user:[0-9a-f-]{36}\)/gi, "@$1")
      .replace(/#\[([^\]]+)\]\((?:client|dossier|task|pole):[0-9a-f-]{36}\)/gi, "#$1");

    const raw = await callLovableAi([
      {
        role: "system",
        content:
          "Tu extrais une tâche actionnable depuis un message d'équipe. Réponds UNIQUEMENT en JSON strict, sans texte autour, avec ce schéma : {\"title\": string (max 120 caractères, verbe d'action), \"description\": string (contexte court, 1-3 phrases), \"priority\": \"basse\"|\"normale\"|\"haute\"|\"urgente\", \"due_date\": string|null (ISO YYYY-MM-DD si une date/échéance est mentionnée, sinon null)}. Français.",
      },
      {
        role: "user",
        content: `Contexte : conversation "${conv?.titre ?? ""}" (type: ${conv?.type ?? "direct"}).\nMessage : ${clean}`,
      },
    ]);

    // Parse défensif
    let parsed: any = null;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      parsed = { title: clean.slice(0, 120), description: clean, priority: "normale", due_date: null };
    }

    const priorities = ["basse", "normale", "haute", "urgente"];
    return {
      title: String(parsed.title ?? "").slice(0, 200) || "Nouvelle tâche",
      description: String(parsed.description ?? "") || null,
      priority: priorities.includes(parsed.priority) ? parsed.priority : "normale",
      due_date: parsed.due_date ?? null,
      // Suggestion de rattachement
      pole_id: conv?.pole_id ?? null,
      client_id: conv?.client_id ?? null,
      dossier_id: conv?.dossier_id ?? null,
    };
  });

/**
 * Crée réellement la tâche après validation utilisateur.
 */
export const createTaskFromDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(4000).nullable().optional(),
        priority: z.enum(["basse", "normale", "haute", "urgente"]).default("normale"),
        due_date: z.string().nullable().optional(),
        assigned_to: z.string().uuid().nullable().optional(),
        pole_id: z.string().uuid().nullable().optional(),
        client_id: z.string().uuid().nullable().optional(),
        dossier_id: z.string().uuid().nullable().optional(),
        source_message_id: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: task, error } = await supabase
      .from("agency_tasks")
      .insert({
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        due_date: data.due_date ?? null,
        assigned_to: data.assigned_to ?? null,
        pole_id: data.pole_id ?? null,
        client_id: data.client_id ?? null,
        dossier_id: data.dossier_id ?? null,
        created_by: userId,
        status: "a_faire",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: task.id };
  });
