import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const robotTestConnexion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const r = await import("@/server/slackRobot.server");
    return r.robotAuthTest();
  });

export const robotCanaux = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const r = await import("@/server/slackRobot.server");
    return r.robotListChannels();
  });

export const robotSyncMembres = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const r = await import("@/server/slackRobot.server");
    return r.robotSyncMembres(context.supabase);
  });

export const robotDemarrer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        channels: z
          .array(
            z.object({
              slack_channel_id: z.string().min(1),
              nom: z.string().trim().min(1, "Le nom du canal est manquant"),
              type: z.preprocess(
                (value) => (typeof value === "string" && value.trim() ? value : "public"),
                z.string(),
              ),
              is_archived: z.boolean().nullish().transform((value) => value ?? false),
              membres_count: z
                .number()
                .int()
                .nonnegative()
                .nullish()
                .transform((value) => value ?? 0),
            }),
          )
          .min(1),
        estimation_total: z.number().int().nonnegative().default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const a = await import("@/server/clientAcces.server");
      await a.assertStaff(context.supabase, context.userId);
      const r = await import("@/server/slackRobot.server");
      const result = await r.robotStart(
        context.supabase,
        context.userId,
        data.channels,
        data.estimation_total,
      );
      return { ok: true as const, ...result };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[robotDemarrer] Échec du démarrage :", detail);
      return {
        ok: false as const,
        error: `Impossible de démarrer la collecte Slack : ${detail}`,
      };
    }
  });

export const robotStatut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ statut: z.enum(["en_cours", "pause", "termine"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const r = await import("@/server/slackRobot.server");
    return r.robotSetStatut(context.supabase, data.statut);
  });

export const robotEtat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const r = await import("@/server/slackRobot.server");
    return r.robotStatus(context.supabase);
  });

/** Passage manuel (bouton « Avancer maintenant »), en plus du planificateur. */
export const robotAvancer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const r = await import("@/server/slackRobot.server");
    const res = await r.runTick(context.supabase);
    return JSON.parse(JSON.stringify(res)) as Record<string, string | number | boolean | null>;
  });

