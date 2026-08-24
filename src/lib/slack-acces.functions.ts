import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const channelSchema = z.object({ id: z.string(), name: z.string() });

const importRowSchema = z.object({
  channel_id: z.string(),
  channel_name: z.string(),
  message_ts: z.string(),
  libelle: z.string().min(1),
  plateforme: z.string().nullish(),
  url: z.string().nullish(),
  identifiant: z.string().nullish(),
  secret: z.string().nullish(),
  client_id: z.string().uuid().nullish(),
  organisme: z.string().nullish(),
});

export const slackTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const s = await import("@/server/slackAcces.server");
    return s.slackTest();
  });

export const slackListChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const s = await import("@/server/slackAcces.server");
    return s.slackChannels();
  });

export const slackScanChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ channels: z.array(channelSchema).min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const s = await import("@/server/slackAcces.server");
    return s.slackScan(context.supabase, data.channels);
  });

export const slackImportAcces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rows: z.array(importRowSchema).min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const a = await import("@/server/clientAcces.server");
    await a.assertStaff(context.supabase, context.userId);
    const s = await import("@/server/slackAcces.server");
    return s.slackImport(context.supabase, context.userId, data.rows as any);
  });
