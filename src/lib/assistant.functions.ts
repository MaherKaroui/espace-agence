import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Conversation avec l'assistant IA (tool calling, lecture sous RLS utilisateur). */
export const assistantChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
          .min(1)
          .max(40),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const {
      resolveCaller,
      buildAssistantTools,
      assistantSystemPrompt,
      createRefRegistry,
      sanitizeAssistantText,
      ASSISTANT_MODEL,
    } = await import("./assistant.server");
    const caller = await resolveCaller(context.supabase, context.userId);
    const proposals: any[] = [];
    // Les UUID ne sortent jamais vers le modèle : ils restent dans ce registre serveur.
    const refs = createRefRegistry();
    const tools = buildAssistantTools(caller, proposals, refs);

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const { generateText, stepCountIs } = await import("ai");

    const { text } = await generateText({
      model: gateway(ASSISTANT_MODEL) as any,
      system: assistantSystemPrompt(caller.isStaff),
      messages: data.messages,
      tools: tools as any,
      // Le modèle a le droit de répondre sans appeler d'outil (salutations, questions générales).
      toolChoice: "auto",
      stopWhen: stepCountIs(6),
    });

    // Filet de sécurité : aucun identifiant technique ne doit atteindre l'interface.
    return { text: sanitizeAssistantText(text ?? "", refs), proposals, isStaff: caller.isStaff };
  });

/** Exécute une action proposée, APRÈS confirmation explicite de l'utilisateur. */
export const assistantConfirmAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ action: z.any() }).parse(data))
  .handler(async ({ data, context }) => {
    const { resolveCaller, executeAssistantAction, proposalSchema } = await import("./assistant.server");
    const caller = await resolveCaller(context.supabase, context.userId);
    const action = proposalSchema.parse(data.action);
    return await executeAssistantAction(caller, action as any);
  });

/** Modèles de pièces (lecture) — utilisé par l'écran d'administration. */
export const listPiecesModeles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ categorie: z.string().optional() }).parse(data ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("demande_pieces_modeles")
      .select("id, categorie, libelle, motif, obligatoire, ordre, actif")
      .order("categorie")
      .order("ordre");
    if (data.categorie) q = q.eq("categorie", data.categorie as any);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });
