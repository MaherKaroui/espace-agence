import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const accesSchema = z.object({
  id: z.string().uuid().nullish(),
  client_id: z.string().uuid().nullish(),
  dossier_id: z.string().uuid().nullish(),
  organisme: z.string().nullish(),
  libelle: z.string().min(1),
  plateforme: z.string().nullish(),
  url: z.string().nullish(),
  identifiant: z.string().nullish(),
  secret: z.string().nullish(),
  clear_secret: z.boolean().optional(),
  notes: z.string().nullish(),
});

export const listClientAcces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await import("@/server/clientAcces.server");
    await m.assertStaff(context.supabase, context.userId);
    return m.listAccesRows(context.supabase);
  });

export const saveClientAcces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => accesSchema.parse(d))
  .handler(async ({ data, context }) => {
    const m = await import("@/server/clientAcces.server");
    await m.assertStaff(context.supabase, context.userId);
    return m.saveAcces(context.supabase, context.userId, data as any);
  });

export const deleteClientAcces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const m = await import("@/server/clientAcces.server");
    await m.assertStaff(context.supabase, context.userId);
    await m.deleteAcces(context.supabase, data.id);
    return { ok: true };
  });

export const revealClientAcces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        field: z.enum(["identifiant", "secret"]),
        mode: z.enum(["affichage", "copie"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const m = await import("@/server/clientAcces.server");
    await m.assertStaff(context.supabase, context.userId);
    return m.revealAcces(context.supabase, data.id, data.field, data.mode);
  });
